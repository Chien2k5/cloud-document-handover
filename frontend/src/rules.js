export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = value => typeof value === 'string' && UUID_PATTERN.test(value);
export const canWrite = project => ['OWNER', 'EDITOR'].includes(project?.role);
export const canOwn = project => project?.role === 'OWNER';
export const isVerified = file => file?.uploadStatus === 'AVAILABLE' && file?.integrityStatus === 'VERIFIED';
