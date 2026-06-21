import { render, screen, fireEvent, act } from '@testing-library/react';
import VoiceConsole from '../components/VoiceConsole';
import '@testing-library/jest-dom';


// Mock the VoiceClient since we don't want to actually connect to WebSockets in UI tests
jest.mock('@/lib/voiceClient', () => {
  return {
    VoiceClient: jest.fn().mockImplementation(() => {
      return {
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

describe('VoiceConsole', () => {
  it('renders correctly in idle state', async () => {
    await act(async () => {
      render(<VoiceConsole />);
    });
    expect(screen.getByText('Lead Generation Console')).toBeTruthy();
    expect(screen.getByText('Tap the orb and start talking.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start conversation' })).toBeTruthy();
  });

  it('clicking start button changes state', async () => {
    await act(async () => {
      render(<VoiceConsole />);
    });
    const button = screen.getByRole('button', { name: 'Start conversation' });
    await act(async () => {
      fireEvent.click(button);
    });
    // Since mock start resolves immediately, it might transition to connecting then live,
    // or just connecting. Let's just check if it stops being idle.
    expect(screen.queryByText('Tap the orb and start talking.')).toBeNull();
  });
});


