import { qualityVerdict } from './documents.service';

describe('qualityVerdict: quality is advisory, only an unusable file is rejected', () => {
  it('blur, crop, glare and low resolution are warnings, never a rejection', () => {
    expect(
      qualityVerdict({
        usable: false,
        issues: [
          'image_blurred: text edge sharpness 0.21 is below the 0.45 minimum',
          'glare_detected: 18% of the page area is overexposed',
          'page_cropped: the bottom edge of the document is cut off',
        ],
      }),
    ).toEqual({
      usable: true,
      warnings: [
        'image_blurred: text edge sharpness 0.21 is below the 0.45 minimum',
        'glare_detected: 18% of the page area is overexposed',
        'page_cropped: the bottom edge of the document is cut off',
      ],
    });
    expect(qualityVerdict({ usable: true, issues: ['cut_off_edge', 'low_resolution'] })).toEqual({
      usable: true,
      warnings: ['cut_off_edge', 'low_resolution'],
    });
  });

  it('a blank page, a corrupt file or an unusable PDF is rejected', () => {
    expect(qualityVerdict({ usable: false, issues: ['blank_page', 'blurred'] }).usable).toBe(false);
    expect(qualityVerdict({ usable: false, issues: ['unreadable_file'] }).usable).toBe(false);
    expect(qualityVerdict({ usable: false, issues: ['pdf_encrypted'] }).usable).toBe(false);
    expect(qualityVerdict({ usable: false, issues: [] }).usable).toBe(false);
  });
});
