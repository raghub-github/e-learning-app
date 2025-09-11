// src/redux/slices/authSlice.js
import { createSlice } from '@reduxjs/toolkit';
import { authApi } from '../api/authApi';

const initialState = {
  user: null, // logged in user info
  isAuthenticated: false,
  loading: false,
  error: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logoutClient: state => {
      state.user = null;
      state.isAuthenticated = false;
      state.error = null;
    },
  },
  extraReducers: builder => {
    // ---- Signup ----
    builder.addMatcher(authApi.endpoints.signup.matchPending, state => {
      state.loading = true;
      state.error = null;
    });
    builder.addMatcher(authApi.endpoints.signup.matchFulfilled, (state, { payload }) => {
      state.loading = false;
      state.user = payload.user;
      state.isAuthenticated = true;
    });
    builder.addMatcher(authApi.endpoints.signup.matchRejected, (state, { error }) => {
      state.loading = false;
      state.error = error?.data?.message || error.message;
    });

    // ---- Login ----
    builder.addMatcher(authApi.endpoints.login.matchPending, state => {
      state.loading = true;
      state.error = null;
    });
    builder.addMatcher(authApi.endpoints.login.matchFulfilled, (state, { payload }) => {
      state.loading = false;
      state.user = payload.user;
      state.isAuthenticated = true;
    });
    builder.addMatcher(authApi.endpoints.login.matchRejected, (state, { error }) => {
      state.loading = false;
      state.error = error?.data?.message || error.message;
    });

    // ---- Logout ----
    builder.addMatcher(authApi.endpoints.logout.matchFulfilled, state => {
      state.user = null;
      state.isAuthenticated = false;
      state.loading = false;
    });

    // ---- Me (get current user) ----
    builder.addMatcher(authApi.endpoints.me.matchFulfilled, (state, { payload }) => {
      state.user = payload.user;
      state.isAuthenticated = true;
    });
    builder.addMatcher(authApi.endpoints.me.matchRejected, state => {
      state.user = null;
      state.isAuthenticated = false;
    });
  },
});

export const { logoutClient } = authSlice.actions;

export default authSlice.reducer;
