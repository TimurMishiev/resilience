import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSignalRuleMatches } from '../api/signal_rule_matches'
import type { SignalRuleMatch, SignalRuleMatchesParams } from '../api/types'

export interface EvidenceLinkedIds {
  evidenceSignalIds: string[]
  evidenceSiteIds: string[]
}

const EVIDENCE_LINKED_PER_PAGE = 100

async function fetchAllEvidenceLinkedMatches(
  params: SignalRuleMatchesParams,
): Promise<SignalRuleMatch[]> {
  const firstPage = await getSignalRuleMatches({
    ...params,
    page: 1,
    per_page: EVIDENCE_LINKED_PER_PAGE,
  })

  const matches = [...firstPage.data]

  for (let page = 2; page <= firstPage.meta.total_pages; page += 1) {
    const nextPage = await getSignalRuleMatches({
      ...params,
      page,
      per_page: EVIDENCE_LINKED_PER_PAGE,
    })
    matches.push(...nextPage.data)
  }

  return matches
}

export function useEvidenceLinkedIds(
  selectedSiteId: string | null,
  selectedSignalId: string | null,
  asOf: string | null,
): EvidenceLinkedIds {
  const siteMatchParams = useMemo<SignalRuleMatchesParams | undefined>(
    () => (selectedSiteId ? { site_id: selectedSiteId, ...(asOf ? { as_of: asOf } : {}) } : undefined),
    [asOf, selectedSiteId],
  )

  const signalMatchParams = useMemo<SignalRuleMatchesParams | undefined>(
    () => (selectedSignalId ? { signal_id: selectedSignalId, ...(asOf ? { as_of: asOf } : {}) } : undefined),
    [asOf, selectedSignalId],
  )

  const { data: siteMatches } = useQuery({
    queryKey: ['signal_rule_matches', 'evidence-linked', 'site', siteMatchParams],
    queryFn: () => fetchAllEvidenceLinkedMatches(siteMatchParams!),
    enabled: !!siteMatchParams,
    refetchInterval: false,
  })

  const { data: signalMatches } = useQuery({
    queryKey: ['signal_rule_matches', 'evidence-linked', 'signal', signalMatchParams],
    queryFn: () => fetchAllEvidenceLinkedMatches(signalMatchParams!),
    enabled: !!signalMatchParams,
    refetchInterval: false,
  })

  const evidenceSignalIds = useMemo(() => {
    if (!siteMatches) return []
    const ids = new Set<string>()
    for (const match of siteMatches) {
      if (match.signal?.id) ids.add(match.signal.id)
    }
    return [...ids]
  }, [siteMatches])

  const evidenceSiteIds = useMemo(() => {
    if (!signalMatches) return []
    const ids = new Set<string>()
    for (const match of signalMatches) {
      if (match.site?.id) ids.add(match.site.id)
    }
    return [...ids]
  }, [signalMatches])

  return { evidenceSignalIds, evidenceSiteIds }
}
