export function getNotesText(raw) {
  if (!raw) return '';
  if (typeof raw !== 'string') return String(raw);

  // BlockNote JSON format (array of blocks)
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return extractFromBlocks(parsed);
    }
  } catch {}

  // Tiptap JSON format (doc with content)
  try {
    const doc = JSON.parse(raw);
    if (doc && doc.type === 'doc' && Array.isArray(doc.content)) {
      return extractFromDoc(doc.content);
    }
  } catch {}

  if (raw.includes('<') && raw.includes('>')) {
    return raw.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return raw;
}

export function getNotesPreviewText(raw, maxLength) {
  const text = getNotesText(raw);
  if (!maxLength || text.length <= maxLength) return text;
  return text.slice(0, maxLength).replace(/\s+\S*$/, '') + '…';
}

function extractFromBlocks(blocks) {
  let result = '';
  for (const block of blocks) {
    if (block.content && Array.isArray(block.content)) {
      for (const inline of block.content) {
        if (inline.type === 'text' || typeof inline.text === 'string') {
          result += inline.text || '';
        }
      }
    }
    if (block.children && Array.isArray(block.children)) {
      result += extractFromBlocks(block.children);
    }
    result += ' ';
  }
  return result.trim();
}

function extractFromDoc(nodes) {
  let result = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      result += node.text || '';
    }
    if (node.content && Array.isArray(node.content)) {
      result += extractFromDoc(node.content);
    }
    if (node.type === 'paragraph' || node.type === 'heading') {
      result += '\n';
    }
  }
  return result.trim();
}
