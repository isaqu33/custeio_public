/**
 * @jest-environment node
 */
export {};

const enqueueMock = jest.fn();
const existsMock = jest.fn();
const orgMock = jest.fn();
const envMock: { ANTHROPIC_API_KEY?: string } = { ANTHROPIC_API_KEY: 'k' };

jest.mock('@/app/lib/env', () => ({ env: envMock }));
jest.mock('@/app/lib/jobs/service', () => ({ createAndEnqueueJob: enqueueMock }));
jest.mock('@/app/lib/services/stores', () => ({ getStoreOrganizationId: orgMock }));
jest.mock('@/app/models/jobs', () => ({ __esModule: true, default: { exists: existsMock } }));

beforeEach(() => {
  jest.clearAllMocks();
  envMock.ANTHROPIC_API_KEY = 'k';
  orgMock.mockResolvedValue('665f735a90788d97f5a76300');
  existsMock.mockResolvedValue(null);
  enqueueMock.mockResolvedValue({});
});

describe('requestIngredientsReviewAfterCapture', () => {
  it('queues one system-started review for the store', async () => {
    const { requestIngredientsReviewAfterCapture } =
      await import('@/app/lib/services/ingredient-review-trigger');

    expect(await requestIngredientsReviewAfterCapture('store1')).toBe(true);
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ai.ingredients.review',
        payload: { storeId: 'store1' },
      }),
    );
  });

  it('does nothing without an AI key, or while a review is already queued or running', async () => {
    const { requestIngredientsReviewAfterCapture } =
      await import('@/app/lib/services/ingredient-review-trigger');
    envMock.ANTHROPIC_API_KEY = undefined;
    expect(await requestIngredientsReviewAfterCapture('store1')).toBe(false);

    envMock.ANTHROPIC_API_KEY = 'k';
    existsMock.mockResolvedValue({ _id: 'j' });
    expect(await requestIngredientsReviewAfterCapture('store1')).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('never throws into the capture that called it', async () => {
    enqueueMock.mockRejectedValue(new Error('redis down'));
    const { requestIngredientsReviewAfterCapture } =
      await import('@/app/lib/services/ingredient-review-trigger');

    await expect(requestIngredientsReviewAfterCapture('store1')).resolves.toBe(false);
  });
});
