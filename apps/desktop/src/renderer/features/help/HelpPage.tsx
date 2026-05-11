import {
  Wifi,
  AlertTriangle,
  HardDrive,
  UploadCloud,
  Shield,
  FolderOpen,
  Globe,
  Apple,
  Monitor,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@renderer/components/ui/accordion';
import { GiftCardSection } from '@renderer/features/settings/GiftCardSection';

interface QuickStartStep {
  title: string;
  description: string;
}

interface DirectoryCard {
  title: string;
  points: string[];
}

interface PermissionSection {
  title: string;
  steps: string[];
}

interface FaqItem {
  question: string;
  answer: string;
}

interface ErrorCard {
  title: string;
  description: string;
}

const macPermissionIcons: LucideIcon[] = [Shield, Globe, FolderOpen, Apple];
const windowsPermissionIcons: LucideIcon[] = [Shield, Globe, FolderOpen, Monitor];
const errorIcons: LucideIcon[] = [Wifi, HardDrive, AlertTriangle, UploadCloud];

export function HelpPage() {
  const { t } = useTranslation();
  const quickStartSteps = t('help.quickStart.steps', { returnObjects: true }) as QuickStartStep[];
  const directoryCards = t('help.directory.cards', { returnObjects: true }) as DirectoryCard[];
  const macPermissionSections = t('help.permissions.mac', {
    returnObjects: true,
  }) as PermissionSection[];
  const windowsPermissionSections = t('help.permissions.windows', {
    returnObjects: true,
  }) as PermissionSection[];
  const uploadRules = t('help.uploadRules.items', { returnObjects: true }) as string[];
  const faqItems = t('help.faq.items', { returnObjects: true }) as FaqItem[];
  const errorCards = t('help.errors.cards', { returnObjects: true }) as ErrorCard[];

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-1 text-xl font-semibold text-foreground">{t('help.title')}</h1>
        <p className="mb-8 text-sm text-muted-foreground">{t('help.subtitle')}</p>

        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">
            {t('help.quickStart.title')}
          </h2>
          <GlassCard className="p-5">
            <ol className="space-y-4">
              {quickStartSteps.map((step, idx) => (
                <li key={step.title} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">
                    {idx + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{step.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </GlassCard>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">
            {t('help.directory.title')}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {directoryCards.map((card) => (
              <GlassCard key={card.title} className="p-4">
                <p className="mb-2 text-sm font-semibold text-foreground">{card.title}</p>
                <ul className="space-y-1">
                  {card.points.map((point) => (
                    <li key={point} className="text-xs leading-relaxed text-muted-foreground">
                      • {point}
                    </li>
                  ))}
                </ul>
              </GlassCard>
            ))}
          </div>

          <GlassCard className="mt-4 p-4">
            <pre className="whitespace-pre font-mono text-xs leading-relaxed text-foreground">
              {t('help.directory.tree')}
            </pre>
          </GlassCard>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">
            {t('help.permissions.title')}
          </h2>

          <div className="mb-3 flex items-center gap-2">
            <Apple className="h-4 w-4 text-gray-700" />
            <span className="text-sm font-semibold text-foreground">macOS</span>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-4">
            {macPermissionSections.map((section, index) => {
              const Icon = macPermissionIcons[index] ?? Shield;
              return (
                <GlassCard key={`mac-${section.title}`} className="p-4">
                  <div className="mb-2.5 flex items-center gap-2">
                    <Icon className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-semibold text-foreground">{section.title}</span>
                  </div>
                  <ol className="space-y-1.5 pl-1">
                    {section.steps.map((step, i) => (
                      <li
                        key={step}
                        className="flex gap-2 text-xs leading-relaxed text-muted-foreground"
                      >
                        <span className="shrink-0 text-muted-foreground/60">{i + 1}.</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </GlassCard>
              );
            })}
          </div>

          <div className="mb-3 flex items-center gap-2">
            <Monitor className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-foreground">Windows</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {windowsPermissionSections.map((section, index) => {
              const Icon = windowsPermissionIcons[index] ?? Shield;
              return (
                <GlassCard key={`win-${section.title}`} className="p-4">
                  <div className="mb-2.5 flex items-center gap-2">
                    <Icon className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-semibold text-foreground">{section.title}</span>
                  </div>
                  <ol className="space-y-1.5 pl-1">
                    {section.steps.map((step, i) => (
                      <li
                        key={step}
                        className="flex gap-2 text-xs leading-relaxed text-muted-foreground"
                      >
                        <span className="shrink-0 text-muted-foreground/60">{i + 1}.</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </GlassCard>
              );
            })}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">
            {t('help.uploadRules.title')}
          </h2>
          <GlassCard className="p-5">
            <ul className="space-y-1.5">
              {uploadRules.map((rule) => (
                <li key={rule} className="text-xs leading-relaxed text-muted-foreground">
                  • {rule}
                </li>
              ))}
            </ul>
          </GlassCard>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">{t('help.faq.title')}</h2>
          <GlassCard className="px-5">
            <Accordion type="multiple">
              {faqItems.map((item, idx) => (
                <AccordionItem key={item.question} value={`faq-${idx}`}>
                  <AccordionTrigger className="text-sm font-medium text-foreground">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-xs leading-relaxed text-muted-foreground">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </GlassCard>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">
            {t('help.errors.title')}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {errorCards.map((card, index) => {
              const Icon = errorIcons[index] ?? AlertTriangle;
              return (
                <GlassCard key={card.title} className="p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Icon className="h-4 w-4 text-orange-500" />
                    <span className="text-sm font-semibold text-foreground">{card.title}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {card.description}
                  </p>
                </GlassCard>
              );
            })}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">
            {t('settings.giftCard.title')}
          </h2>
          <GiftCardSection />
        </section>
      </div>
    </div>
  );
}
