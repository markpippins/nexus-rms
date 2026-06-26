/**
 * Simplified Markdown → HTML renderer used across nebula-ui.
 * Shared between system-info, audit-viewer, and any future markdown displays.
 */
export function renderMarkdown(text: string): string {
  if (!text) return '<p class="text-gray-400 italic">No content</p>';

  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Fenced code blocks
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    '<pre class="bg-gray-900 text-green-400 dark:bg-gray-950 p-4 rounded-lg overflow-x-auto text-sm my-3 leading-relaxed"><code>$2</code></pre>'
  );

  // Inline code
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono text-pink-600 dark:text-pink-400">$1</code>'
  );

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4 class="text-base font-semibold mt-4 mb-1 text-gray-800 dark:text-gray-100">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-5 mb-2 text-gray-800 dark:text-gray-100">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold mt-6 mb-2 text-gray-800 dark:text-gray-100">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-7 mb-3 text-gray-900 dark:text-white">$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Unordered list items
  html = html.replace(/^- (.+)$/gm, '<li class="ml-5 list-disc text-gray-700 dark:text-gray-300">$1</li>');

  // Ordered list items
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-5 list-decimal text-gray-700 dark:text-gray-300">$1</li>');

  // Links
  html = html.replace(
    /\[(.+?)\]\((.+?)\)/g,
    '<a href="$2" class="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener">$1</a>'
  );

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="my-6 border-gray-300 dark:border-gray-600">');

  // Blockquotes
  html = html.replace(
    /^> (.+)$/gm,
    '<blockquote class="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400 my-2">$1</blockquote>'
  );

  // Wrap remaining lines in paragraphs
  const lines = html.split('\n');
  const result: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      inList = false;
      continue;
    }

    const isBlock = /^<(h[1-4]|pre|blockquote|hr|li|ol|ul)/.test(trimmed);
    const isListItem = /^<li/.test(trimmed);

    if (isListItem) {
      inList = true;
      result.push(trimmed);
    } else if (isBlock) {
      inList = false;
      result.push(trimmed);
    } else {
      inList = false;
      result.push(`<p class="mb-2 text-gray-700 dark:text-gray-300 leading-relaxed">${trimmed}</p>`);
    }
  }

  return result.join('\n');
}
