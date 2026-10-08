// Public playback URL for the R2 bucket. The upload Worker URL is filled in
// after deploying cloudflare/r2-upload-worker.js.
export const R2_PUBLIC_URL = 'https://pub-3ea4c040a37a4783b7c138a408dec9cf.r2.dev';
// Cloudflare Worker that authenticates uploads and streams multipart data to R2.
export const R2_UPLOAD_ENDPOINT = 'https://falling-mode-66e1tv-uni-r2-upload.jv-rocha998.workers.dev';
