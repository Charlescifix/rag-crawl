import { CheckCircle2, FileText, Globe, Lock, Search, Server } from 'lucide-react';

const steps = [
  { label: 'URL validation', detail: 'Domain is checked and private IP ranges are blocked.', icon: Globe, done: true },
  { label: 'Crawl job', detail: 'Pages are fetched same-domain only, respecting robots.txt.', icon: Server, done: true },
  { label: 'Text extraction', detail: 'Navigation, scripts and boilerplate are stripped out.', icon: FileText, done: true },
  { label: 'Markdown + index', detail: 'Clean text is saved and split into searchable chunks.', icon: Search, done: true },
  { label: 'AI query', detail: 'Top matching chunks are sent to the model with your question.', icon: Lock, done: true },
];

export function WorkflowTimeline() {
  return (
    <section className="panel timeline-panel" id="workflow">
      <div className="section-heading">
        <div>
          <p className="eyebrow">How it works</p>
          <h2>Pipeline</h2>
        </div>
      </div>
      <div className="timeline">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <div key={step.label} className="timeline-step">
              <div className="timeline-step__icon">
                {step.done ? <CheckCircle2 size={18} /> : <Icon size={18} />}
              </div>
              <div>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
