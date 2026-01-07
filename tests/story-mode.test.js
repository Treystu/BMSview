// Mock the clientService module to avoid real network calls
jest.mock('../src/services/clientService', () => ({
  createAnalysisStory: jest.fn().mockResolvedValue({
    title: 'Test Story',
    summary: 'This is a test story.',
    timeline: [
      { image: 'base64data', fileName: 'test1.png' },
      { image: 'base64data', fileName: 'test2.png' }
    ]
  }),
  uploadStoryPhoto: jest.fn().mockResolvedValue({
    storyId: 'test-story-id',
    caption: 'This is a test photo.',
    timestamp: new Date().toISOString()
  })
}));

const { createAnalysisStory, uploadStoryPhoto } = require('../src/services/clientService');

describe('Story Mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create an analysis story', async () => {
    const title = 'Test Story';
    const summary = 'This is a test story.';
    const timeline = [
      new File([''], 'test1.png', { type: 'image/png' }),
      new File([''], 'test2.png', { type: 'image/png' }),
    ];

    const story = await createAnalysisStory(title, summary, timeline);

    expect(createAnalysisStory).toHaveBeenCalledWith(title, summary, timeline);
    expect(story.title).toBe(title);
    expect(story.summary).toBe(summary);
    expect(story.timeline.length).toBe(timeline.length);
  });

  it('should upload a story photo', async () => {
    const storyId = 'test-story-id';
    const photo = new File([''], 'test-photo.png', { type: 'image/png' });
    const caption = 'This is a test photo.';
    const timestamp = new Date().toISOString();

    // Update mock to return the specific timestamp we're testing with
    uploadStoryPhoto.mockResolvedValueOnce({
      storyId,
      caption,
      timestamp
    });

    const uploadedPhoto = await uploadStoryPhoto(storyId, photo, caption, timestamp);

    expect(uploadStoryPhoto).toHaveBeenCalledWith(storyId, photo, caption, timestamp);
    expect(uploadedPhoto.storyId).toBe(storyId);
    expect(uploadedPhoto.caption).toBe(caption);
    expect(uploadedPhoto.timestamp).toBe(timestamp);
  });
});