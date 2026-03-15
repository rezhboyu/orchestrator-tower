import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { Sidebar } from '../Sidebar';
import { useUiStore } from '../../store/uiStore';

const renderWithI18n = (component: React.ReactNode) => {
  return render(
    <I18nextProvider i18n={i18n}>
      {component}
    </I18nextProvider>
  );
};

describe('Sidebar', () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarCollapsed: false });
  });

  it('renders expanded by default', () => {
    renderWithI18n(<Sidebar />);

    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    expect(sidebar).toHaveClass('w-64');
  });

  it('renders collapsed state correctly', () => {
    useUiStore.setState({ sidebarCollapsed: true });
    renderWithI18n(<Sidebar />);

    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    expect(sidebar).toHaveClass('w-12');
  });

  it('toggles on button click', async () => {
    renderWithI18n(<Sidebar />);

    const toggleBtn = screen.getByTestId('sidebar-toggle');
    await userEvent.click(toggleBtn);

    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    expect(sidebar).toHaveClass('w-12');
  });

  it('toggles on Ctrl+B', () => {
    renderWithI18n(<Sidebar />);

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });

    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  });

  it('shows navigation items when expanded', () => {
    renderWithI18n(<Sidebar />);

    expect(screen.getByText(/projects/i)).toBeInTheDocument();
    expect(screen.getByText(/agents/i)).toBeInTheDocument();
    expect(screen.getByText(/settings/i)).toBeInTheDocument();
  });

  it('hides navigation items when collapsed', () => {
    useUiStore.setState({ sidebarCollapsed: true });
    renderWithI18n(<Sidebar />);

    expect(screen.queryByText(/projects/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/agents/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/settings/i)).not.toBeInTheDocument();
  });
});
