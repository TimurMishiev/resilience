import BriefingPanel from '../components/BriefingPanel'

export default function BriefingPage() {
  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">Operational Briefing</h2>
        <span className="bp6-text-muted">AI-generated summaries grounded in audit data</span>
      </div>
      <BriefingPanel />
    </div>
  )
}
