/**
 * Cleans raw markdown from Firecrawl by stripping navigation, footer,
 * breadcrumbs, feedback widgets, and excessive blank lines.
 */
export function cleanMarkdown(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''

  let text = raw

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '')

  // Remove common navigation patterns (lines with multiple links separated by pipes or bullets)
  text = text.replace(
    /^(?:[\s]*(?:\[.+?\]\(.+?\)[\s]*[|•·|►▸»›→]?[\s]*){3,})$/gm,
    ''
  )

  // Remove breadcrumb patterns: "Home > Products > Item" or "Home / Products / Item"
  // Only match lines that look like breadcrumbs (short segments separated by > or /)
  text = text.replace(
    /^(?:[\w-]{1,30}\s*[>›»→]\s*){2,}[\w-]{1,30}\s*$/gm,
    ''
  )
  // Remove markdown link breadcrumbs: "[Home](/) > [Products](/products) > Item"
  text = text.replace(
    /^(?:\[.+?\]\(.+?\)\s*[>\/›»→]\s*){2,}.*$/gm,
    ''
  )

  // Remove feedback widget patterns
  text = text.replace(
    /^(?:Was this (?:page|article|helpful)[\s\S]*?(?:Yes|No|👍|👎|Thank you))$/gim,
    ''
  )
  text = text.replace(/^(?:Rate this (?:page|article)[\s\S]*?)$/gim, '')
  text = text.replace(/^(?:Did this answer your question\?.*?)$/gim, '')
  text = text.replace(/^(?:(?:👍|👎)\s*(?:Yes|No)\s*)+$/gm, '')

  // Remove "Last updated" / "Last modified" lines
  text = text.replace(
    /^(?:Last (?:updated|modified|edited)[\s:]+.*?)$/gim,
    ''
  )

  // Remove social sharing links
  text = text.replace(
    /^(?:Share (?:this|on)[\s:]*(?:\[.+?\]\(.+?\)[\s,]*)+)$/gim,
    ''
  )

  // Remove common footer patterns
  text = text.replace(
    /^(?:©|Copyright|All rights reserved).*$/gim,
    ''
  )

  // Remove cookie consent lines
  text = text.replace(
    /^(?:This (?:site|website) uses cookies[\s\S]*?)$/gim,
    ''
  )

  // Remove "Skip to content" links
  text = text.replace(/^(?:Skip to (?:main )?content)$/gim, '')

  // Remove lines that are just separators
  text = text.replace(/^(?:[-=_*]{3,})$/gm, '')

  // Remove lines that are just links with no context (standalone nav links)
  text = text.replace(
    /^(?:\[(?:Home|Menu|Back|Next|Previous|Contact|About|Login|Sign (?:in|up))\]\(.+?\)\s*)$/gim,
    ''
  )

  // Collapse multiple blank lines into a maximum of two
  text = text.replace(/\n{3,}/g, '\n\n')

  // Trim leading and trailing whitespace
  text = text.trim()

  return text
}
