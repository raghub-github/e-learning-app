// src/redux/store.js
import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { baseApi } from './api/baseApi';
import { authApi } from './api/authApi';
import authReducer from './slices/authSlice';

export const store = configureStore({
  reducer: {
    // RTK Query APIs
    [baseApi.reducerPath]: baseApi.reducer,
    [authApi.reducerPath]: authApi.reducer,

    // Standard slices
    auth: authReducer,
  },
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({
      serializableCheck: false, // JWT cookies/headers may include non-serializable data
    }).concat(baseApi.middleware, authApi.middleware),
  devTools: process.env.NODE_ENV !== 'production',
});

// Enable auto-refetch on focus/reconnect
setupListeners(store.dispatch);

export default store;
