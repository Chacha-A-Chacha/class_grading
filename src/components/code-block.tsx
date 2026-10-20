/** React escapes all content, so question text and code can never run as HTML. */
export function CodeBlock({ code, language }: { code: string; language?: string | null }) {
  return <pre className="overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-sm leading-relaxed" tabIndex={0} aria-label={language ? `${language} code` : "Code"}><code>{code}</code></pre>;
}
