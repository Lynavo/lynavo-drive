import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/stores/app-store';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog';

const helpSections = ['intro', 'guide', 'upload', 'faq', 'contact'] as const;

type HelpSectionId = (typeof helpSections)[number];
type HelpDialogEntry = {
  title: string;
  body: string;
};

function HelpEntry({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/70 bg-white/52 px-4 py-3.5">
      <p className="text-[13px] font-semibold text-[#17191c]">{title}</p>
      <p className="mt-1.5 text-xs leading-5 text-[#59616d]">{body}</p>
    </div>
  );
}

function SectionContent({ section }: { section: HelpSectionId }) {
  const { t } = useTranslation();
  const entries = t(`help.dialog.sections.${section}.items`, {
    returnObjects: true,
  }) as HelpDialogEntry[];

  if (section === 'guide') {
    return (
      <ol className="flex flex-col gap-2.5">
        {entries.map((step, index) => (
          <li
            key={step.title}
            className="flex gap-3 rounded-lg border border-white/70 bg-white/52 px-4 py-3.5"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1677d2] text-xs font-bold text-white [font-variant-numeric:tabular-nums]">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#17191c]">{step.title}</p>
              <p className="mt-1.5 text-xs leading-5 text-[#59616d]">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {entries.map((entry) => (
        <HelpEntry key={entry.title} title={entry.title} body={entry.body} />
      ))}
    </div>
  );
}

export function HelpDialog() {
  const { t } = useTranslation();
  const isHelpOpen = useAppStore((state) => state.isHelpOpen);
  const setHelpOpen = useAppStore((state) => state.setHelpOpen);
  const [activeSection, setActiveSection] = useState<HelpSectionId>('intro');

  return (
    <Dialog open={isHelpOpen} onOpenChange={setHelpOpen}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[80vh] flex-col gap-0 border-white/70 bg-[#f7fbff]/96 p-0 text-[#17191c] shadow-[0_30px_90px_rgba(23,25,28,0.18)] sm:max-w-[640px]"
      >
        <DialogHeader className="border-b border-white/70 px-5 py-4 text-left">
          <DialogTitle className="text-base font-semibold text-[#17191c]">
            {t('help.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <nav
            className="flex w-[150px] shrink-0 flex-col gap-1 border-r border-white/70 p-2.5"
            aria-label={t('help.dialog.navLabel')}
          >
            {helpSections.map((section) => (
              <button
                key={section}
                type="button"
                onClick={() => setActiveSection(section)}
                aria-current={activeSection === section ? 'true' : undefined}
                className={`rounded-md px-3 py-2 text-left text-[13px] font-medium transition ${
                  activeSection === section
                    ? 'bg-[#eaf6ff] font-semibold text-[#1677d2]'
                    : 'text-[#4f5b68] hover:bg-white/74 hover:text-[#17191c]'
                }`}
              >
                {t(`help.dialog.nav.${section}`)}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            <SectionContent section={activeSection} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
