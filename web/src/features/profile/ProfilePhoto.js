import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { avatarUrl, removeAvatar, setAvatar } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useAccount, useAuth } from "../../app/auth";
import { Avatar } from "../../components/Avatar";
import { usePresence } from "../../lib/presence";
import { PhotoCropper } from "./PhotoCropper";
import styles from "./ProfilePage.module.css";
import { loadPhoto, renderCrop } from "./photo";
// ProfilePhoto shows my photo (or my initial) and, under my name, the
// buttons to choose a new one, cropped round, or to take it away.
export function ProfilePhoto({ children }) {
    const account = useAccount();
    const { signedIn } = useAuth();
    const input = useRef(null);
    const [photo, setPhoto] = useState(null);
    // The window to fit the picture closes softly: it keeps the picture meanwhile.
    const cropper = usePresence(photo);
    const cropping = cropper.shown;
    const [saving, setSaving] = useState(false);
    const [problem, setProblem] = useState("");
    const close = () => {
        if (photo)
            URL.revokeObjectURL(photo.url);
        setPhoto(null);
        setSaving(false);
        setProblem("");
    };
    const choose = (file) => {
        if (!file)
            return;
        setProblem("");
        loadPhoto(file)
            .then(setPhoto)
            .catch((error) => {
            console.error(error);
            setProblem("Questa immagine non si apre. Prova con una foto JPG o PNG.");
        });
    };
    const save = (rect) => {
        if (!photo)
            return;
        setSaving(true);
        setProblem("");
        renderCrop(photo.url, rect)
            .then(setAvatar)
            .then((updated) => {
            signedIn(updated);
            close();
        })
            .catch((error) => {
            console.error(error);
            setProblem(explain(error));
            setSaving(false);
        });
    };
    const remove = () => {
        setProblem("");
        removeAvatar()
            .then(signedIn)
            .catch((error) => {
            console.error(error);
            setProblem(explain(error));
        });
    };
    return (_jsxs("div", { className: styles.identity, children: [_jsx(Avatar, { name: account.name, size: 64, photo: avatarUrl(account.id, account.avatar) }), _jsx("input", { ref: input, type: "file", accept: "image/jpeg,image/png,image/webp", className: styles.fileInput, "aria-label": "Scegli una foto", onChange: (e) => {
                    choose(e.target.files?.[0]);
                    e.target.value = ""; // the same file can be chosen again
                } }), cropping && (_jsx(PhotoCropper, { ref: cropper.ref, leaving: cropper.leaving, photo: cropping, saving: saving, problem: problem, onSave: save, onCancel: close })), _jsxs("div", { children: [children, _jsx(PhotoButtons, { hasPhoto: account.avatar > 0, onChoose: () => input.current?.click(), onRemove: remove, problem: photo ? "" : problem })] })] }));
}
function PhotoButtons({ hasPhoto, onChoose, onRemove, problem, }) {
    return (_jsxs("div", { className: styles.photoButtons, children: [_jsx("button", { type: "button", className: styles.link, onClick: onChoose, children: hasPhoto ? "Cambia foto" : "Aggiungi una foto" }), hasPhoto && (_jsx("button", { type: "button", className: styles.link, onClick: onRemove, children: "Togli la foto" })), problem && (_jsx("p", { role: "alert", className: styles.formProblem, children: problem }))] }));
}
function explain(error) {
    if (!(error instanceof ApiError))
        return "Il server non risponde. Riprova tra poco.";
    switch (error.status) {
        case 400:
        case 413:
            return "Questa foto non va bene. Prova con un'altra.";
        default:
            return "Qualcosa è andato storto sul server. Riprova tra poco.";
    }
}
