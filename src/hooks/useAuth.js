// src/hooks/useAuth.js
'use client';

import { useSelector, useDispatch } from 'react-redux';
import { logoutClient } from '../redux/slices/authSlice';
import { authApi } from '../redux/api/authApi';

export function useAuth() {
  const dispatch = useDispatch();
  const { user, isAuthenticated, loading, error } = useSelector(state => state.auth);

  const isLoggedIn = Boolean(isAuthenticated && user);
  const role = user?.roles?.[0] || 'user';

  const logout = async () => {
    try {
      await dispatch(authApi.endpoints.logout.initiate()).unwrap();
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      dispatch(logoutClient()); // clear client state
    }
  };

  return {
    user,
    isAuthenticated,
    isLoggedIn,
    role,
    loading,
    error,
    logout,
  };
}
