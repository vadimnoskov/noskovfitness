/** The bundled workout library (gzip JSON, inlined as base64 by the build) and its style profile (computed once). */
import libraryGzBase64 from '@workspace/fitness-db/data/published-library.json.gz';
import { publishedProfile } from '@workspace/fitness-db';

export const libraryGz = Buffer.from(libraryGzBase64, 'base64');
let profile: ReturnType<typeof publishedProfile> | undefined;
export const getPublishedProfile = () => (profile ??= publishedProfile(libraryGz));
