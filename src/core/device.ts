import { params } from './util';

/** device facts, read once at load. Phones and tablets (and ?mobile on a desktop, for tests) get the mobile tier. */
const ua = navigator.userAgent;
export const IOS = /iP(hone|od|ad)/.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(ua));
export const COARSE = matchMedia('(pointer: coarse)').matches;
export const MOBILE = params.has('mobile') || COARSE || IOS || /Mobi|Android/i.test(ua);
/** phone-sized: the short side of the screen is at most 500 CSS px */
export const PHONE = MOBILE && Math.min(screen.width, screen.height) <= 500;
/** running from the home screen (PWA / iOS web app) */
export const standalone = () =>
  matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
