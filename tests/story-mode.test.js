const { createAnalysisStory, uploadStoryPhoto } = require('../services/clientService');

describe('Story Mode', () => {
  beforeEach(() => {
    global.FileReader = jest.fn(() => ({
      readAsDataURL: jest.fn(),
      onload: jest.fn(),
      onerror: jest.fn(),
    }));
  });

  it('should create an analysis story', async () => {
    const title = 'Test Story';
    const summary = 'This is a test story.';
    const timeline = [
      new File([''], 'test1.png', { type: 'image/png' }),
      new File([''], 'test2.png', { type: 'image/png' }),
    ];

    const story = await createAnalysisStory(title, summary, timeline);

    expect(story.title).toBe(title);
    expect(story.summary).toBe(summary);
    expect(story.timeline.length).toBe(timeline.length);
  });

  it('should upload a story photo', async () => {
    const storyId = 'test-story-id';
    const photo = new File([''], 'test-photo.png', { type: 'image/png' });
    const caption = 'This is a test photo.';
    const timestamp = new Date().toISOString();

    const uploadedPhoto = await uploadStoryPhoto(storyId, photo, caption, timestamp);

    expect(uploadedPhoto.storyId).toBe(storyId);
    expect(uploadedPhoto.caption).toBe(caption);
    expect(uploadedPhoto.timestamp).toBe(timestamp);
  });
});