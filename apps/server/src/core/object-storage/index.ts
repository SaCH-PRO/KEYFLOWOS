export {
  ObjectStorageService,
  ObjectNotFoundError,
} from "./objectStorage";
export type { S3FileRef } from "./objectStorage";

export type {
  ObjectAclPolicy,
  ObjectAccessGroup,
  ObjectAclRule,
} from "./objectAcl";
export {
  ObjectAccessGroupType,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

export { registerObjectStorageRoutes } from "./routes";
