'use client';

import * as React from 'react';
import { cn } from '@/app/lib/utils';

/**
 * The little bit of markdown an assistant reply actually contains.
 *
 * The chat model answers in prose sprinkled with `**bold**`, `-` bullets and
 * `1.` lists. Rendered as plain text those markers reached the doctor literally,
 * which is the same problem the analysis report had — so replies get the same
 * treatment, minus the report-specific tags.
 *
 * Deliberately not a markdown library: this runs on streamed, half-finished text
 * inside a 340px-wide widget. Only closed inline pairs are formatted, so a reply
 * still arriving mid-`**` reads as text and settles once the pair closes; and
 * nothing here renders HTML, links or images, so a model that echoes markup from
 * a study cannot inject anything into the page.
 *
 * User messages are never passed through this — what somebody typed is shown
 * exactly as they typed it.
 */

const BULLET = /^\s*[•*\-–]\s+/u;
const NUMBERED = /^\s*\d+[.)]\s+/u;
const HEADING = /^\s{0,3}#{1,6}\s+(.+)$/u;

// `**bold**` and `` `code` `` — both must be closed on the same line to count.
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/gu;

type Block =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbers'; items: string[] }
  | { type: 'heading'; text: string };

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];

  for (const line of text.split(/\r?\n/)) {
    const last = blocks[blocks.length - 1];

    if (!line.trim()) {
      // A blank line ends whatever was open; the next line starts a new block.
      if (last && last.type === 'paragraph' && last.lines.length)
        blocks.push({ type: 'paragraph', lines: [] });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: 'heading', text: (heading[1] ?? '').trim() });
      continue;
    }

    const isBullet = BULLET.test(line);
    const isNumber = !isBullet && NUMBERED.test(line);
    if (isBullet || isNumber) {
      const type = isBullet ? ('bullets' as const) : ('numbers' as const);
      const item = line.replace(isBullet ? BULLET : NUMBERED, '').trim();
      if (last && last.type === type) last.items.push(item);
      else blocks.push({ type, items: [item] });
      continue;
    }

    if (last && last.type === 'paragraph') last.lines.push(line.trim());
    else blocks.push({ type: 'paragraph', lines: [line.trim()] });
  }

  return blocks.filter((block) => (block.type === 'paragraph' ? block.lines.length > 0 : true));
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(INLINE).map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={index} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
          return (
            <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <React.Fragment key={index}>{part}</React.Fragment>;
      })}
    </>
  );
}

export function ChatMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = toBlocks(text);

  return (
    <div className={cn('flex flex-col gap-2 break-words leading-relaxed', className)}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <p key={index} className="font-semibold">
              <Inline text={block.text} />
            </p>
          );
        }
        if (block.type === 'bullets' || block.type === 'numbers') {
          const List = block.type === 'bullets' ? 'ul' : 'ol';
          return (
            <List
              key={index}
              className={cn(
                'flex flex-col gap-1',
                block.type === 'bullets' ? 'list-disc pl-4' : 'list-decimal pl-5',
              )}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} />
                </li>
              ))}
            </List>
          );
        }
        // Line breaks inside a paragraph are the model's own; keep them.
        return (
          <p key={index} className="whitespace-pre-wrap">
            <Inline text={block.lines.join('\n')} />
          </p>
        );
      })}
    </div>
  );
}
