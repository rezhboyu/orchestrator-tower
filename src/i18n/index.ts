import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhTW from './zh-TW.json';
import en from './en.json';

const getDefaultLanguage = (): 'zh-TW' | 'en' => {
  const browserLang = navigator.language;
  if (browserLang.startsWith('zh')) {
    return 'zh-TW';
  }
  return 'en';
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-TW': { translation: zhTW },
      en: { translation: en },
    },
    lng: getDefaultLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

export default i18n;
