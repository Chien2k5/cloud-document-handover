import { ApiError } from './api.js';
import { canOwn, isUuid, isVerified } from './rules.js';
export function createHandoverBody({ title, files, recipients, expiresAt }, now = Date.now()) {
  const recipientUserIds = [...new Set(recipients.split(/[\s,;]+/).filter(Boolean))];
  const deadline = new Date(expiresAt);
  if (!title.trim() || title.trim().length > 200 || !files.length || files.some(file => !isVerified(file) || !isUuid(file.id))
      || !recipientUserIds.length || recipientUserIds.some(id => !isUuid(id)) || !Number.isFinite(deadline.getTime()) || deadline.getTime() <= now) throw new ApiError(400, 'VALIDATION_ERROR');
  return { title: title.trim(), fileVersionIds: [...new Set(files.map(file => file.id))], recipientUserIds, expiresAt: deadline.toISOString() };
}
export function handoverPermissions(handover, project, userId, now = Date.now()) {
  if (!handover) return {};
  const active = handover.accessStatus === 'ACTIVE', expired = !(Date.parse(handover.expiresAt) > now);
  const owner = canOwn(project) && project.id === handover.projectId;
  const recipient = handover.recipients.find(person => person.userId === userId && person.accessStatus === 'ACTIVE');
  const published = ['READY', 'CONFIRMED'].includes(handover.status);
  return { expired, publish: owner && active && !expired && handover.status === 'DRAFT',
    revoke: owner && active, confirm: Boolean(recipient && !recipient.confirmedAt && active && !expired && published),
    download: Boolean((owner || recipient) && active && !expired && published) };
}
