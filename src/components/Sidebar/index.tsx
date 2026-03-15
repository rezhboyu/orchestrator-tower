import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../store/uiStore';

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const { sidebarCollapsed, toggleSidebar } = useUiStore();

  // Ctrl+B keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  return (
    <aside
      className={`bg-gray-900 border-r border-gray-700 transition-all duration-200 flex flex-col ${
        sidebarCollapsed ? 'w-12' : 'w-64'
      }`}
      data-testid="sidebar"
      data-collapsed={sidebarCollapsed}
    >
      {/* Toggle Button */}
      <button
        onClick={toggleSidebar}
        className="h-10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800"
        title="Toggle Sidebar (Ctrl+B)"
        data-testid="sidebar-toggle"
      >
        <span className="text-lg">{sidebarCollapsed ? '>' : '<'}</span>
      </button>

      {!sidebarCollapsed && (
        <nav className="flex-1 p-2">
          <ul className="space-y-1">
            <li>
              <a
                href="#projects"
                className="block px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded"
              >
                {t('sidebar.projects')}
              </a>
            </li>
            <li>
              <a
                href="#agents"
                className="block px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded"
              >
                {t('sidebar.agents')}
              </a>
            </li>
            <li>
              <a
                href="#settings"
                className="block px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded"
              >
                {t('sidebar.settings')}
              </a>
            </li>
          </ul>
        </nav>
      )}
    </aside>
  );
};

export default Sidebar;
