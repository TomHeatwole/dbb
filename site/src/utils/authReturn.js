const RETURN_KEY = 'dbb_auth_return_to';

export function setAuthReturnTo(path) {
  try {
    if (path) sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // ignore
  }
}

export function getAuthReturnTo(defaultPath = '/home/') {
  try {
    return sessionStorage.getItem(RETURN_KEY) || defaultPath;
  } catch {
    return defaultPath;
  }
}

export function clearAuthReturnTo() {
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // ignore
  }
}
