import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('FlowPilot Desktop App Shell', () => {
  it('renders the desktop shell heading and local SQLite persistence card', async () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'FlowPilot Desktop' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Local SQLite Persistence' })).toBeDefined();
    expect(screen.getByTestId('offline-ready').textContent).toBe('Yes');
  });
});
