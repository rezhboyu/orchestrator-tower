import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../store/uiStore';
import { useNotificationStore } from '../../store/notificationStore';

export const Toolbar: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { showReasoningTree, setShowReasoningTree, resetLayout, language, setLanguage } = useUiStore();
  const { addNotification } = useNotificationStore();

  const handleResetLayout = () => {
    resetLayout();
    addNotification({
      type: 'success',
      message: t('notifications.layoutReset'),
      duration: 3000,
    });
  };

  const handleLanguageChange = (newLang: 'zh-TW' | 'en') => {
    setLanguage(newLang);
    i18n.changeLanguage(newLang);
  };

  return (
    <header className="h-12 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4">
      <h1 className="text-lg font-semibold text-white">{t('app.title')}</h1>

      <div className="flex items-center gap-4">
        {/* Reset Layout Button */}
        <button
          onClick={handleResetLayout}
          className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
          data-testid="reset-layout-btn"
        >
          {t('toolbar.resetLayout')}
        </button>

        {/* Show Reasoning Tree Toggle */}
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showReasoningTree}
            onChange={(e) => setShowReasoningTree(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
            data-testid="reasoning-tree-toggle"
          />
          {t('toolbar.showReasoningTree')}
        </label>

        {/* Language Selector */}
        <select
          value={language}
          onChange={(e) => handleLanguageChange(e.target.value as 'zh-TW' | 'en')}
          className="px-2 py-1 text-sm bg-gray-700 text-white rounded border border-gray-600"
          data-testid="language-selector"
        >
          <option value="zh-TW">繁體中文</option>
          <option value="en">English</option>
        </select>
      </div>
    </header>
  );
};

export default Toolbar;
