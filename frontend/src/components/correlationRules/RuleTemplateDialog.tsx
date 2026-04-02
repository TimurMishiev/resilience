import { Card, Dialog, DialogBody, Icon, Tag } from '@blueprintjs/core'
import { RULE_TEMPLATES, DEFAULT_FORM, newCondition } from './types'
import type { RuleFormState, RuleTemplate } from './types'

interface RuleTemplateDialogProps {
  isOpen:             boolean
  onClose:            () => void
  onSelectTemplate:   (form: RuleFormState) => void
}

export function RuleTemplateDialog({ isOpen, onClose, onSelectTemplate }: RuleTemplateDialogProps) {
  function applyTemplate(tpl: RuleTemplate) {
    const conditions = (tpl.form.compound_conditions ?? DEFAULT_FORM.compound_conditions)
      .map(c => newCondition(c))
    onSelectTemplate({ ...DEFAULT_FORM, ...tpl.form, compound_conditions: conditions })
    onClose()
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Create from Template"
      icon="duplicate"
      style={{ width: 680 }}
    >
      <DialogBody>
        <p className="bp6-text-muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 13 }}>
          Select a pre-built rule template. All fields are editable before saving.
        </p>
        <div className="rule-templates-grid">
          {RULE_TEMPLATES.map(tpl => (
            <Card
              key={tpl.id}
              interactive
              compact
              className="rule-template-card"
              onClick={() => applyTemplate(tpl)}
            >
              <div className="rule-template-header">
                <Icon icon={tpl.icon as Parameters<typeof Icon>[0]['icon']} size={16} className="rule-template-icon" />
                <span className="rule-template-name">{tpl.name}</span>
              </div>
              <p className="rule-template-description">{tpl.description}</p>
              <div className="rule-template-tags">
                {tpl.tags.map(tag => (
                  <Tag
                    key={tag}
                    minimal
                    intent={
                      tag.includes('compound') ? 'warning'
                      : tag.includes('M') ? 'danger'
                      : 'primary'
                    }
                    style={{ fontSize: 10 }}
                  >
                    {tag}
                  </Tag>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </DialogBody>
    </Dialog>
  )
}
