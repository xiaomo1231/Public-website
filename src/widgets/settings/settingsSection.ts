/*
 * Settings section shells, shared by every section of the settings page so
 * they line up. Lecture lays each section out as a ruled row — serif title
 * and note on the left, controls on the right. Lab keeps a hairline panel
 * with a mono label bar.
 */
export const SETTINGS_SECTION =
  'lecture:rounded-none lecture:border-x-0 lecture:border-t-0 lecture:bg-transparent lecture:shadow-none md:lecture:grid md:lecture:grid-cols-[13rem_minmax(0,1fr)] md:lecture:gap-8'
export const SETTINGS_SECTION_HEAD =
  'lecture:px-0 lecture:pb-2 md:lecture:pb-6 lab:border-b lab:px-3.5 lab:py-2.5'
export const SETTINGS_SECTION_TITLE =
  'lecture:font-heading lecture:text-base lecture:font-bold lecture:leading-snug lab:font-mono lab:text-[11px] lab:font-normal lab:uppercase lab:tracking-wider lab:text-muted-foreground'
export const SETTINGS_SECTION_BODY = 'lecture:px-0 md:lecture:pt-6 lab:p-3.5 lab:pt-3.5'

/** Class names a section component accepts so the page can give it the shared shell. */
export interface SectionShellProps {
  className?: string
  headerClassName?: string
  titleClassName?: string
  bodyClassName?: string
}

export const SETTINGS_SHELL: Required<SectionShellProps> = {
  className: SETTINGS_SECTION,
  headerClassName: SETTINGS_SECTION_HEAD,
  titleClassName: SETTINGS_SECTION_TITLE,
  bodyClassName: SETTINGS_SECTION_BODY,
}
