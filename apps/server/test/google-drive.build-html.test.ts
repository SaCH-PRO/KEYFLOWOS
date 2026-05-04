import { describe, it, expect } from 'vitest';
import { GoogleDriveService } from '../src/modules/google-drive/google-drive.service';

function makeService(): GoogleDriveService {
  // Bypass DI: only buildDocumentHtml is exercised, no Prisma/connector access.
  return new (GoogleDriveService as unknown as new () => GoogleDriveService)();
}

describe('GoogleDriveService.buildDocumentHtml', () => {
  const svc = makeService();

  it('strips dangerous tags and handlers from HTML sections', () => {
    const html = svc.buildDocumentHtml({
      title: 'Doc',
      documentType: 'Type',
      category: 'Cat',
      version: 1,
      sections: [
        {
          sectionName: 'Section',
          contentFormat: 'HTML',
          content:
            '<h2>ok</h2><p onclick="alert(1)">click</p><script>alert(2)</script><a href="javascript:alert(3)">x</a>',
        },
      ],
    });

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<h2>ok</h2>');
    expect(html).toContain('click');
  });

  it('preserves headings, lists, and inline formatting in HTML sections', () => {
    const html = svc.buildDocumentHtml({
      title: 'Doc',
      documentType: 'Type',
      category: 'Cat',
      version: 1,
      sections: [
        {
          sectionName: 'Section',
          contentFormat: 'HTML',
          content: '<h1>Title</h1><ul><li><strong>bold</strong> and <em>italic</em></li></ul>',
        },
      ],
    });

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('escapes content for plain-text sections', () => {
    const html = svc.buildDocumentHtml({
      title: 'Doc',
      documentType: 'Type',
      category: 'Cat',
      version: 1,
      sections: [
        {
          sectionName: 'Section',
          contentFormat: 'PLAIN',
          content: '<script>alert(1)</script>',
        },
      ],
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
