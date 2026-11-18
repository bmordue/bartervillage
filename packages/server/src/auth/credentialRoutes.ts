/**
 * Account credential management (spec §12; M4.C04).
 *
 * A player may hold several credentials. Secrets and public keys are never
 * returned; the API only lists enough to show what is linked. Removing the last
 * credential is refused so an account cannot lock itself out.
 */

import type { ApiRequest, JsonResponse, Routes } from "../api.js";
import { guardCsrf } from "../cookies.js";
import {
  deleteCredential,
  listPlayerCredentials,
  loadCredential,
} from "../db/credentialRepository.js";
import type { Database } from "../db/database.js";
import { loadRequestPlayerId } from "./requestSession.js";

function notAuthenticated(): JsonResponse {
  return { status: 401, body: { error: "not_authenticated" } };
}

export function createCredentialRoutes(db: Database): Routes {
  return {
    "GET /auth/credentials": (request) => {
      const playerId = loadRequestPlayerId(db, request);
      if (playerId === undefined) {
        return notAuthenticated();
      }
      const credentials = listPlayerCredentials(db, playerId).map((credential) => ({
        id: credential.id,
        kind: credential.kind,
        createdAt: credential.createdAt,
      }));
      return { status: 200, body: { credentials } };
    },

    "DELETE /auth/credentials/:id": guardCsrf((request: ApiRequest) => {
      const playerId = loadRequestPlayerId(db, request);
      if (playerId === undefined) {
        return notAuthenticated();
      }
      const credentialId = request.params?.id ?? "";
      const credential = loadCredential(db, credentialId);
      if (credential === undefined || credential.playerId !== playerId) {
        return { status: 404, body: { error: "credential_not_found" } };
      }
      if (listPlayerCredentials(db, playerId).length <= 1) {
        return { status: 409, body: { error: "last_credential" } };
      }
      deleteCredential(db, credentialId);
      return { status: 200, body: { ok: true } };
    }),
  };
}
