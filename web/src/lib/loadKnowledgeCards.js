let pending

export function loadKnowledgeCards() {
  pending ||= import('../pages/Cards.jsx')
  return pending
}
