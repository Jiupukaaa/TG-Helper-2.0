const NOTE_PAGE_SIZE = 3500;

export function paginateNoteText(text: string, pageSize = NOTE_PAGE_SIZE): string[] {
  if (text.length <= pageSize) return [text];

  const pages: string[] = [];
  let remaining = text;

  while (remaining.length > pageSize) {
    let splitAt = remaining.lastIndexOf("\n", pageSize);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(" ", pageSize);
    if (splitAt <= 0) splitAt = pageSize;

    pages.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);

    if (remaining.startsWith("\n") || remaining.startsWith(" ")) {
      remaining = remaining.slice(1);
    }
  }

  if (remaining) pages.push(remaining);
  return pages;
}
