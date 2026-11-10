import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { DEFAULT_BASE_URL } from '../agent/contract.ts';
import { trackEvent } from '../analytics.ts';
import { IconCheck, IconClose, IconCopy, IconSparkle } from './Icons.tsx';

export interface AiImportDialogHandle {
  open: () => void;
}

/**
 * The agent guide an assistant should follow: this deployment's, unless it runs on this computer, where
 * no assistant could reach it.
 */
function guideUrl(): string {
  const local = /^(localhost|127\.|\[::1\])/.test(window.location.hostname);
  const base = local ? DEFAULT_BASE_URL : window.location.origin + import.meta.env.BASE_URL;
  return new URL('llms.txt', base).href;
}

/**
 * “Map your booking with AI”: GlobeHops has no assistant of its own, so it hands the visitor a short prompt
 * for theirs. The assistant reads the published agent guide (llms.txt) and replies with a GlobeHops link
 * for the booking attached alongside the prompt. Nothing about the booking reaches GlobeHops.
 */
export const AiImportDialog = forwardRef<AiImportDialogHandle>(function AiImportDialog(_, ref) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const promptRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const prompt = t('ai.prompt', guideUrl());
  useImperativeHandle(ref, () => ({
    open: () => {
      setCopied(false);
      dialogRef.current?.showModal();
      trackEvent('ai_import_open');
    },
  }));
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      trackEvent('ai_prompt_copy');
    } catch {
      // Without clipboard access, select the prompt so the system's own Copy works.
      const node = promptRef.current;
      const selection = window.getSelection();
      if (!node || !selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="about ai-import"
      aria-labelledby="ai-import-title"
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <div className="about__inner">
        <button
          type="button"
          className="icon-btn about__close"
          aria-label={t('common.close')}
          onClick={() => dialogRef.current?.close()}
        >
          <IconClose />
        </button>
        <div className="ai-import__head">
          <span className="ai-import__mark" aria-hidden="true">
            <IconSparkle size={22} />
          </span>
          <h2 id="ai-import-title">{t('ai.title')}</h2>
        </div>
        <p className="ai-import__lede">{t('ai.lede')}</p>
        <ol className="ai-import__steps">
          <li>
            <span className="ai-import__step">{t('ai.step1')}</span>
            <div className="ai-import__prompt">
              <div className="ai-import__bar">
                <span className="ai-import__label">{t('ai.promptLabel')}</span>
                <button
                  type="button"
                  className={`ai-import__copy${copied ? ' is-copied' : ''}`}
                  aria-label={copied ? t('ai.copied') : t('ai.copyPrompt')}
                  onClick={copy}
                >
                  <span className="ai-import__copy-icon" aria-hidden="true">
                    {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                  </span>
                  <span aria-hidden="true">{copied ? t('ai.copied') : t('ai.copy')}</span>
                </button>
              </div>
              <pre>
                <code ref={promptRef}>{prompt}</code>
              </pre>
            </div>
          </li>
          <li>
            <span className="ai-import__step">{t('ai.step2')}</span>
          </li>
          <li>
            <span className="ai-import__step">{t('ai.step3')}</span>
          </li>
        </ol>
        <p className="ai-import__privacy">{t('ai.privacy')}</p>
        <p className="sr-only" aria-live="polite">
          {copied ? t('ai.copied') : ''}
        </p>
      </div>
    </dialog>
  );
});

/** The planner's way in: a quiet card under the empty route. */
export function AiImportEntry({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="ai-entry" onClick={onOpen}>
      <span className="ai-entry__icon" aria-hidden="true">
        <IconSparkle size={18} />
      </span>
      <span className="ai-entry__text">
        <span className="ai-entry__title">{t('ai.entry')}</span>
        <span className="ai-entry__detail">{t('ai.entryDetail')}</span>
      </span>
    </button>
  );
}
