import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('FlowPilot Web Companion App', () => {
  it('renders the web companion heading and contract version badge', () => {
    render(<App autoCheckHealth={false} apiBaseUrl="http://localhost:5080" />);

    expect(screen.getByRole('heading', { name: 'FlowPilot Web Companion' })).toBeDefined();
    expect(screen.getByText('Contract v1')).toBeDefined();
    expect(screen.getByTestId('api-connection-state').textContent).toBe('idle');
  });
});
