/**
 * True when the address names a topic id the loaded course does not contain.
 *
 * The tutor pages must then show "topic not found" — never fall back to
 * another topic, which would also generate (and pay for) its lesson.
 */
export function isUnknownTopic(
  topicId: string | undefined,
  topics: ReadonlyArray<{ id: string }>,
): boolean {
  return Boolean(topicId) && !topics.some((topic) => topic.id === topicId)
}
