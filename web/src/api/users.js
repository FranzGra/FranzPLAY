// The people of this FranzPLAY, as the administrator manages them.
import { parseAccount } from "./auth";
import { request } from "./client";
function parsePerson(data) {
    const account = parseAccount(data);
    const { lastLogin } = data;
    if (lastLogin === null)
        return { ...account, lastLogin: null };
    if (typeof lastLogin !== "string" || Number.isNaN(Date.parse(lastLogin))) {
        throw new Error("person: bad lastLogin");
    }
    return { ...account, lastLogin: new Date(lastLogin) };
}
export async function fetchUsers(signal) {
    const data = await request("/api/users", { signal });
    if (!Array.isArray(data))
        throw new Error("users: not a list");
    return data.map(parsePerson);
}
export async function createUser(person) {
    return parseAccount(await request("/api/users", { method: "POST", body: person }));
}
// updateUser changes what a person may do. Without uploadQuota (bytes),
// the person keeps the space they have.
export async function updateUser(id, change) {
    return parseAccount(await request(`/api/users/${id}`, { method: "PUT", body: change }));
}
// resetPassword gives a person a new password; they are logged out everywhere.
export async function resetPassword(id, password) {
    await request(`/api/users/${id}/password`, { method: "PUT", body: { password } });
}
export async function deleteUser(id) {
    await request(`/api/users/${id}`, { method: "DELETE" });
}
