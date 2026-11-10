import { isUuid } from './rules.js';

export function readWorkspaceHash(hash = '') {
  const path = hash.replace(/^#/, '');
  if (!path || path === '/' || path === '/projects') return { view: 'projects' };
  if (path === '/handovers') return { view: 'handovers' };
  const project = path.match(/^\/projects\/([^/]+)(?:\/(overview|files|members))?$/);
  if (project && isUuid(project[1])) return { view: 'project', projectId: project[1], section: project[2] || 'overview' };
  const handover = path.match(/^\/handovers\/([^/]+)$/);
  if (handover && isUuid(handover[1])) return { view: 'handovers', handoverId: handover[1] };
  return { view: path.startsWith('/handovers') ? 'handovers' : 'projects', invalid: true };
}
export const projectHash = (id, section = 'overview') => isUuid(id) && ['overview', 'files', 'members'].includes(section) ? `#/projects/${id}/${section}` : '#/projects';
export const handoverHash = id => isUuid(id) ? `#/handovers/${id}` : '#/handovers';

export function focusWorkspaceSection(id) {
  const target = document.getElementById(id);
  if (target) { target.scrollIntoView({ block: 'start' }); target.focus({ preventScroll: true }); }
}
