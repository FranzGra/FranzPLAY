package users

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// maxBody is the largest request body accepted by these routes.
const maxBody = 4 << 10

// Routes adds the users API to mux:
//
//	GET    /api/setup         does FranzPLAY still need its administrator? may people register?
//	POST   /api/setup         create the administrator {code, name, password}
//	POST   /api/login         {name, password}
//	POST   /api/logout
//	GET    /api/me            the logged-in user (401 if nobody)
//	POST   /api/me/password   {current, new}
//	GET    /api/users         administrators only
//	POST   /api/users         administrators only {name, password, role, canUpload}
//	PUT    /api/users/{id}    administrators only {role, canUpload}
//	DELETE /api/users/{id}    administrators only
//	PUT    /api/users/{id}/password  administrators only {password}
//	GET    /api/invites       administrators only
//	POST   /api/invites       administrators only {note, canUpload}: the invite and its code
//	DELETE /api/invites/{id}  administrators only
//	POST   /api/join/check    does an invite code still work? {code}
//	POST   /api/join          create an account with an invite {code, name, password}
//	GET    /api/registration  administrators only: may anyone create an account? {open}
//	PUT    /api/registration  administrators only {open}
//	POST   /api/register      create an account without an invite, when allowed {name, password}
func (s *Service) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/setup", s.handleSetupStatus)
	mux.HandleFunc("POST /api/setup", s.handleSetup)
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("POST /api/logout", s.handleLogout)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("POST /api/me/password", s.handlePassword)
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
	mux.HandleFunc("GET /api/registration", s.adminOnly(s.handleRegistration))
	mux.HandleFunc("PUT /api/registration", s.adminOnly(s.handleSetRegistration))
	mux.HandleFunc("POST /api/register", s.handleRegister)
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
	case errors.Is(err, errBadName), errors.Is(err, errWeakPassword), errors.Is(err, errBadNote):
		respond.Error(w, r, s.logger, http.StatusBadRequest, err.Error())
	case errors.Is(err, errBadCredentials), errors.Is(err, errBadSetupCode):
		respond.Error(w, r, s.logger, http.StatusUnauthorized, err.Error())
	case errors.Is(err, errTooManyTries):
		w.Header().Set("Retry-After", strconv.Itoa(int(lockout.Seconds())))
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
	// OpenRegistration says the login page may offer to create an account.
	OpenRegistration bool `json:"openRegistration"`
}

func (s *Service) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	open, err := s.store.openRegistration(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, setupStatus{Needed: s.needsSetup(), OpenRegistration: open})
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
	a, token, err := s.login(r.Context(), req.Name, req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	setCookie(w, r, token)
	respond.JSON(w, r, s.logger, http.StatusOK, a)
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
	err := s.changePassword(r.Context(), a, token, req.Current, req.New)
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
	respond.JSON(w, r, s.logger, http.StatusOK, list)
}

type createRequest struct {
	Name      string `json:"name"`
	Password  string `json:"password"`
	Role      string `json:"role"`
	CanUpload bool   `json:"canUpload"`
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
	a, err := s.create(r.Context(), req.Name, req.Password, role, req.CanUpload, false)
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
	Role      string `json:"role"`
	CanUpload bool   `json:"canUpload"`
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
	a, err := s.store.updateUser(r.Context(), id, role, req.CanUpload)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	admin, _ := FromContext(r.Context())
	s.logger.InfoContext(r.Context(), "user changed", "name", a.Name, "role", a.Role,
		"can_upload", a.CanUpload, "by", admin.Name)
	respond.JSON(w, r, s.logger, http.StatusOK, a)
}

type resetRequest struct {
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
	if err := s.resetPassword(r.Context(), admin, token, id, req.Password); err != nil {
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
	a, err := s.join(r.Context(), req.Code, req.Name, req.Password)
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
