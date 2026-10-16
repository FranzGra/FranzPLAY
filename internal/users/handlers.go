package users

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// maxBody is the largest request body accepted by these routes.
const maxBody = 4 << 10

// Routes adds the users API to mux:
//
//	GET    /api/setup         does FranzPLAY still need its administrator? may people register?
//	POST   /api/setup         create the administrator {name, password, code if asked}
//	POST   /api/login/method  {name}: how that name logs in {method}; names that do not exist get a decoy
//	POST   /api/login         {name, password}: password is the password, the PIN or the pattern
//	POST   /api/logout
//	GET    /api/me            the logged-in user (401 if nobody)
//	POST   /api/me/password   {current, new}: a new password
//	PUT    /api/me/credential {current, method, secret}: a new password, PIN or pattern
//	POST   /api/me/check      {current}: is it my password, PIN or pattern? (wrong ones count)
//	PUT    /api/me/name       {name}: the user with the new name
//	PUT    /api/me/color      {color}: "#rrggbb", or "" for FranzPLAY's own
//	PUT    /api/me/avatar     a square JPEG or PNG picture: my new profile photo
//	DELETE /api/me/avatar     no profile photo any more
//	GET    /api/users/{id}/avatar  someone's profile photo
//	DELETE /api/me            delete my own account {password}, with everything of mine
//	GET    /api/users         administrators only
//	POST   /api/users         administrators only {name, method, password, role, canUpload, ownMethods}
//	PUT    /api/users/{id}    administrators only {role, canUpload, uploadQuota, canSharePublic, ownMethods}:
//	                          left out, a field keeps its value; ownMethods [] follows the server
//	DELETE /api/users/{id}    administrators only
//	PUT    /api/users/{id}/password  administrators only {method, password}
//	GET    /api/invites       administrators only
//	POST   /api/invites       administrators only {note, canUpload}: the invite and its code
//	DELETE /api/invites/{id}  administrators only
//	POST   /api/join/check    does an invite code still work? {code}
//	POST   /api/join          create an account with an invite {code, name, password}
//	GET    /api/logins        administrators only: the access log, 100 at a time,
//	                          newest first; ?q= part of name or address, ?failed=1, ?before=id
//	GET    /api/registration  administrators only: may anyone create an account? {open}
//	PUT    /api/registration  administrators only {open}
//	POST   /api/register      create an account without an invite, when allowed {name, method, password}
//	GET    /api/login-methods administrators only: the methods the server allows {methods}
//	PUT    /api/login-methods administrators only {methods}
//	GET    /api/logins/blocks administrators only: names and addresses blocked now
//	POST   /api/logins/unblock administrators only {key}
func (s *Service) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/setup", s.handleSetupStatus)
	mux.HandleFunc("POST /api/setup", s.handleSetup)
	mux.HandleFunc("POST /api/login/method", s.handleLoginMethod)
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("POST /api/logout", s.handleLogout)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("POST /api/me/password", s.handlePassword)
	mux.HandleFunc("PUT /api/me/credential", s.handleCredential)
	mux.HandleFunc("POST /api/me/check", s.handleCheck)
	mux.HandleFunc("PUT /api/me/name", s.handleRename)
	mux.HandleFunc("PUT /api/me/color", s.handleAccentColor)
	mux.HandleFunc("PUT /api/me/skip", s.handleSkipSeconds)
	mux.HandleFunc("PUT /api/me/avatar", s.handleSetAvatar)
	mux.HandleFunc("DELETE /api/me/avatar", s.handleRemoveAvatar)
	mux.HandleFunc("GET /api/users/{id}/avatar", s.handleAvatar)
	mux.HandleFunc("DELETE /api/me", s.handleDeleteMe)
	mux.HandleFunc("GET /api/users", s.adminOnly(s.handleList))
	mux.HandleFunc("POST /api/users", s.adminOnly(s.handleCreate))
	mux.HandleFunc("PUT /api/users/{id}", s.adminOnly(s.handleUpdate))
	mux.HandleFunc("DELETE /api/users/{id}", s.adminOnly(s.handleDelete))
	mux.HandleFunc("PUT /api/users/{id}/password", s.adminOnly(s.handleReset))
	mux.HandleFunc("GET /api/invites", s.adminOnly(s.handleInvites))
	mux.HandleFunc("POST /api/invites", s.adminOnly(s.handleCreateInvite))
	mux.HandleFunc("DELETE /api/invites/{id}", s.adminOnly(s.handleDeleteInvite))
	mux.HandleFunc("POST /api/join/check", s.handleCheckInvite)
	mux.HandleFunc("POST /api/join", s.handleJoin)
	mux.HandleFunc("GET /api/logins", s.adminOnly(s.handleLogins))
	mux.HandleFunc("GET /api/registration", s.adminOnly(s.handleRegistration))
	mux.HandleFunc("PUT /api/registration", s.adminOnly(s.handleSetRegistration))
	mux.HandleFunc("POST /api/register", s.handleRegister)
	mux.HandleFunc("GET /api/login-methods", s.adminOnly(s.handleServerMethods))
	mux.HandleFunc("PUT /api/login-methods", s.adminOnly(s.handleSetServerMethods))
	mux.HandleFunc("GET /api/logins/blocks", s.adminOnly(s.handleBlocks))
	mux.HandleFunc("POST /api/logins/unblock", s.adminOnly(s.handleUnblock))
}

// readJSON reads a small JSON body into v. Unknown fields are refused, so
// a typo in the interface is caught at once.
func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// fail answers an error: the ones people can fix with their own words,
// anything else as an internal error.
func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errBadName), errors.Is(err, errWeakPassword), errors.Is(err, errBadNote),
		errors.Is(err, errBadColor), errors.Is(err, errBadAvatar), errors.Is(err, errBadPIN), errors.Is(err, errBadPattern),
		errors.Is(err, errBadMethods), errors.Is(err, errMethodNotAllowed), errors.Is(err, errBadSkip):
		respond.Error(w, r, s.logger, http.StatusBadRequest, err.Error())
	case errors.Is(err, errBadCredentials), errors.Is(err, errBadSetupCode):
		respond.Error(w, r, s.logger, http.StatusUnauthorized, err.Error())
	case errors.Is(err, errTooManyTries):
		var blocked blockedError
		if errors.As(err, &blocked) {
			w.Header().Set("Retry-After", strconv.Itoa(int(roundWait(blocked.Wait).Seconds())))
		}
		respond.Error(w, r, s.logger, http.StatusTooManyRequests, err.Error())
	case errors.Is(err, errTooManyAccounts):
		w.Header().Set("Retry-After", strconv.Itoa(int(registrationWindow.Seconds())))
		respond.Error(w, r, s.logger, http.StatusTooManyRequests, err.Error())
	case errors.Is(err, errRegistrationClosed):
		respond.Error(w, r, s.logger, http.StatusForbidden, err.Error())
	case errors.Is(err, errNameTaken), errors.Is(err, errAlreadySetUp), errors.Is(err, errLastAdmin):
		respond.Error(w, r, s.logger, http.StatusConflict, err.Error())
	case errors.Is(err, errInviteInvalid):
		respond.Error(w, r, s.logger, http.StatusGone, err.Error())
	case errors.Is(err, errUserNotFound), errors.Is(err, errInviteMissing):
		respond.Error(w, r, s.logger, http.StatusNotFound, err.Error())
	default:
		respond.InternalError(w, r, s.logger, err)
	}
}

func (s *Service) badRequest(w http.ResponseWriter, r *http.Request) {
	respond.Error(w, r, s.logger, http.StatusBadRequest, "the request is not valid JSON with the expected fields")
}

type setupStatus struct {
	Needed bool `json:"needed"`
	// CodeNeeded says the setup form must ask for the code in the log.
	CodeNeeded bool `json:"codeNeeded"`
	// OpenRegistration says the login page may offer to create an account.
	OpenRegistration bool `json:"openRegistration"`
	// Methods are the login methods a new account may choose.
	Methods Methods `json:"methods"`
}

func (s *Service) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	open, err := s.store.openRegistration(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	methods, err := s.serverMethodsCached(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, setupStatus{
		Needed:           s.needsSetup(),
		CodeNeeded:       s.needsSetupCode(),
		OpenRegistration: open,
		Methods:          methods,
	})
}

type setupRequest struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

func (s *Service) handleSetup(w http.ResponseWriter, r *http.Request) {
	var req setupRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	a, err := s.setup(r.Context(), req.Code, req.Name, req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	token, err := s.startSession(r.Context(), a)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	setCookie(w, r, token)
	respond.JSON(w, r, s.logger, http.StatusCreated, a)
}

type loginRequest struct {
	Name     string `json:"name"`
	Password string `json:"password"`
}

func (s *Service) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	a, token, err := s.login(r.Context(), s.clientAddr(r), req.Name, req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	setCookie(w, r, token)
	respond.JSON(w, r, s.logger, http.StatusOK, a)
}

type methodRequest struct {
	Name string `json:"name"`
}

type methodAnswer struct {
	Method Method `json:"method"`
}

// handleLoginMethod tells the login page what to show after the name: a
// password field, the PIN pad or the pattern grid.
func (s *Service) handleLoginMethod(w http.ResponseWriter, r *http.Request) {
	var req methodRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	m, err := s.methodOf(r.Context(), req.Name)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, methodAnswer{Method: m})
}

func (s *Service) handleLogout(w http.ResponseWriter, r *http.Request) {
	if token, ok := r.Context().Value(tokenKey{}).(string); ok {
		if err := s.store.deleteSession(r.Context(), hashToken(token)); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	clearCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleMe(w http.ResponseWriter, r *http.Request) {
	a, ok := FromContext(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, a)
}

type passwordRequest struct {
	Current string `json:"current"`
	New     string `json:"new"`
}

func (s *Service) handlePassword(w http.ResponseWriter, r *http.Request) {
	a, ok := FromContext(r.Context())
	token, _ := r.Context().Value(tokenKey{}).(string)
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	var req passwordRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	s.answerChange(w, r, s.changeCredential(r.Context(), a, token, req.Current, Password, req.New))
}

type credentialRequest struct {
	Current string `json:"current"`
	Method  Method `json:"method"`
	Secret  string `json:"secret"`
}

// handleCredential sets my new password, PIN or pattern, after checking
// the current one.
func (s *Service) handleCredential(w http.ResponseWriter, r *http.Request) {
	a, ok := FromContext(r.Context())
	token, _ := r.Context().Value(tokenKey{}).(string)
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	var req credentialRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	s.answerChange(w, r, s.changeCredential(r.Context(), a, token, req.Current, req.Method, req.Secret))
}

type checkRequest struct {
	Current string `json:"current"`
}

// handleCheck confirms my current secret, so the profile can ask for it
// before showing the choice of a new one. The change checks it again.
func (s *Service) handleCheck(w http.ResponseWriter, r *http.Request) {
	a, ok := FromContext(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	var req checkRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	s.answerChange(w, r, s.confirmSecret(r.Context(), a, req.Current))
}

// answerChange answers a change that needed the current secret.
func (s *Service) answerChange(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, errBadCredentials) {
		// Not 401: that would tell the interface the login is gone, and
		// the person is still logged in.
		respond.Error(w, r, s.logger, http.StatusForbidden, "the current password is not right")
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// adminOnly lets only administrators through.
func (s *Service) adminOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		a, ok := FromContext(r.Context())
		if !ok {
			respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
			return
		}
		if a.Role != Admin {
			respond.Error(w, r, s.logger, http.StatusForbidden, "administrators only")
			return
		}
		next(w, r)
	}
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.list(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := make([]Person, len(list))
	for i, p := range list {
		a, err := s.withMethods(r.Context(), p.Account, p.method, p.own)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		out[i] = Person{Account: a, LastLogin: p.LastLogin}
	}
	respond.JSON(w, r, s.logger, http.StatusOK, out)
}

type createRequest struct {
	Name      string `json:"name"`
	Method    Method `json:"method"`   // "" means password
	Password  string `json:"password"` // the password, the PIN or the pattern
	Role      string `json:"role"`
	CanUpload bool   `json:"canUpload"`
	// OwnMethods narrows the methods the person may use; empty follows the server.
	OwnMethods []Method `json:"ownMethods"`
}

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	role, ok := parseRole(req.Role)
	if !ok {
		respond.Error(w, r, s.logger, http.StatusBadRequest, `the role must be "admin" or "user"`)
		return
	}
	a, err := s.createByAdmin(r.Context(), req, role)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	admin, _ := FromContext(r.Context())
	s.logger.InfoContext(r.Context(), "user created", "name", a.Name, "role", a.Role, "by", admin.Name)
	respond.JSON(w, r, s.logger, http.StatusCreated, a)
}

// userID reads the {id} of the address. When it is not a valid id it
// answers 404 itself and returns false.
func (s *Service) userID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond.Error(w, r, s.logger, http.StatusNotFound, errUserNotFound.Error())
		return 0, false
	}
	return id, true
}

type updateRequest struct {
	// OwnMethods narrows the person's login methods; [] follows the
	// server, nil (left out) keeps what they have.
	OwnMethods  *[]Method `json:"ownMethods"`
	Role        string    `json:"role"`
	CanUpload   bool      `json:"canUpload"`
	UploadQuota *int64    `json:"uploadQuota"` // nil: unchanged
	// CanSharePublic lets them make public links; nil: unchanged.
	CanSharePublic *bool `json:"canSharePublic"`
}

func (s *Service) handleUpdate(w http.ResponseWriter, r *http.Request) {
	id, ok := s.userID(w, r)
	if !ok {
		return
	}
	var req updateRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	role, ok := parseRole(req.Role)
	if !ok {
		respond.Error(w, r, s.logger, http.StatusBadRequest, `the role must be "admin" or "user"`)
		return
	}
	if q := req.UploadQuota; q != nil && (*q < MinUploadQuota || *q > MaxUploadQuota) {
		respond.Error(w, r, s.logger, http.StatusBadRequest, "the upload quota must be between 1 GiB and 100 TiB")
		return
	}
	own, err := s.ownMethods(r.Context(), req.OwnMethods)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	stored, revoked, err := s.store.updateUser(r.Context(), id, role, req.CanUpload, req.CanSharePublic, req.UploadQuota, own)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	a, err := s.withMethods(r.Context(), stored.Account, stored.method, stored.own)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	admin, _ := FromContext(r.Context())
	s.logger.InfoContext(r.Context(), "user changed", "name", a.Name, "role", a.Role,
		"can_upload", a.CanUpload, "can_share_public", a.CanSharePublic, "upload_quota", a.UploadQuota,
		"public_links_revoked", revoked, "own_methods", a.OwnMethods.String(), "by", admin.Name)
	respond.JSON(w, r, s.logger, http.StatusOK, a)
}

type resetRequest struct {
	Method   Method `json:"method"` // "" means password
	Password string `json:"password"`
}

func (s *Service) handleReset(w http.ResponseWriter, r *http.Request) {
	id, ok := s.userID(w, r)
	if !ok {
		return
	}
	var req resetRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	admin, _ := FromContext(r.Context())
	token, _ := r.Context().Value(tokenKey{}).(string)
	if err := s.resetPassword(r.Context(), admin, token, id, req.Method, req.Password); err != nil {
		s.fail(w, r, err)
		return
	}
	s.logger.InfoContext(r.Context(), "password reset", "id", id, "by", admin.Name)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := s.userID(w, r)
	if !ok {
		return
	}
	admin, _ := FromContext(r.Context())
	if err := s.store.deleteUser(r.Context(), id); err != nil {
		s.fail(w, r, err)
		return
	}
	s.forgetAvatar(r.Context(), id)
	s.logger.InfoContext(r.Context(), "user deleted", "id", id, "by", admin.Name)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleInvites(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.listInvites(r.Context(), s.now())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, list)
}

type inviteRequest struct {
	Note      string `json:"note"`
	CanUpload bool   `json:"canUpload"`
}

// newInvite is a new invite with the code of its link, shown only now.
type newInvite struct {
	Invite
	Code string `json:"code"`
}

func (s *Service) handleCreateInvite(w http.ResponseWriter, r *http.Request) {
	var req inviteRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	admin, _ := FromContext(r.Context())
	inv, code, err := s.createInvite(r.Context(), admin, req.Note, req.CanUpload)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.logger.InfoContext(r.Context(), "invite created", "id", inv.ID, "can_upload", inv.CanUpload, "by", admin.Name)
	respond.JSON(w, r, s.logger, http.StatusCreated, newInvite{Invite: inv, Code: code})
}

func (s *Service) handleDeleteInvite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond.Error(w, r, s.logger, http.StatusNotFound, errInviteMissing.Error())
		return
	}
	if err := s.store.deleteInvite(r.Context(), id); err != nil {
		s.fail(w, r, err)
		return
	}
	admin, _ := FromContext(r.Context())
	s.logger.InfoContext(r.Context(), "invite deleted", "id", id, "by", admin.Name)
	w.WriteHeader(http.StatusNoContent)
}

type checkInviteRequest struct {
	Code string `json:"code"`
}

func (s *Service) handleCheckInvite(w http.ResponseWriter, r *http.Request) {
	var req checkInviteRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	if err := s.checkInvite(r.Context(), req.Code); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type joinRequest struct {
	Method   Method `json:"method"` // "" means password
	Code     string `json:"code"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

func (s *Service) handleJoin(w http.ResponseWriter, r *http.Request) {
	var req joinRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	a, err := s.join(r.Context(), req.Code, req.Name, req.Method, req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	token, err := s.startSession(r.Context(), a)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.logger.InfoContext(r.Context(), "joined with an invite", "name", a.Name)
	setCookie(w, r, token)
	respond.JSON(w, r, s.logger, http.StatusCreated, a)
}

// createByAdmin adds a person made by the administrator, with the method
// and the narrowing chosen in the form.
func (s *Service) createByAdmin(ctx context.Context, req createRequest, role Role) (Account, error) {
	own, err := s.ownMethods(ctx, &req.OwnMethods)
	if err != nil {
		return Account{}, err
	}
	a := Account{Role: role, CanUpload: req.CanUpload, LoginMethod: req.Method}
	if a.LoginMethod == "" {
		a.LoginMethod = Password
	}
	if own != nil {
		a.OwnMethods = *own
	}
	server, err := s.serverMethodsCached(ctx)
	if err != nil {
		return Account{}, err
	}
	if !slices.Contains(effective(server, a.OwnMethods), a.LoginMethod) {
		return Account{}, errMethodNotAllowed
	}
	return s.createWith(ctx, a, req.Name, req.Password, false)
}

// ownMethods checks a narrowing chosen by the administrator: nil keeps
// what the person has, an empty list follows the server, anything else
// must be methods the server allows.
func (s *Service) ownMethods(ctx context.Context, list *[]Method) (*Methods, error) {
	if list == nil {
		return nil, nil
	}
	if len(*list) == 0 {
		return &Methods{}, nil
	}
	ms, err := normalize(*list)
	if err != nil {
		return nil, err
	}
	server, err := s.serverMethodsCached(ctx)
	if err != nil {
		return nil, err
	}
	for _, m := range ms {
		if !slices.Contains(server, m) {
			return nil, errMethodNotAllowed
		}
	}
	return &ms, nil
}

type serverMethods struct {
	Methods []Method `json:"methods"`
}

func (s *Service) handleServerMethods(w http.ResponseWriter, r *http.Request) {
	ms, err := s.serverMethodsCached(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, serverMethods{Methods: ms})
}

func (s *Service) handleSetServerMethods(w http.ResponseWriter, r *http.Request) {
	var req serverMethods
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	ms, err := s.setServerMethods(r.Context(), req.Methods)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	admin, _ := FromContext(r.Context())
	s.logger.InfoContext(r.Context(), "login methods changed", "methods", ms.String(), "by", admin.Name)
	respond.JSON(w, r, s.logger, http.StatusOK, serverMethods{Methods: ms})
}
