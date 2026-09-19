import { HomeMediaService, type HomeMediaRepository } from "./home-media";
import {
  S3PrivateUploadSigner,
  S3TemporaryObjectSigner,
  s3PrivateObjectStorageConfigFromEnv,
} from "./private-object-storage";

export function homeMediaServiceFromEnv(
  repository: HomeMediaRepository,
  env: NodeJS.ProcessEnv = process.env,
): HomeMediaService | undefined {
  const config = s3PrivateObjectStorageConfigFromEnv(env);
  if (!config) return undefined;
  return new HomeMediaService(
    repository,
    new S3PrivateUploadSigner(config),
    new S3TemporaryObjectSigner(config),
    config.provider,
  );
}
