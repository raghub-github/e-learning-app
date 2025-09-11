// src/redux/api/baseApi.js
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { Mutex } from 'async-mutex';

// Mutex to prevent multiple refresh calls
const mutex = new Mutex();

const baseQuery = fetchBaseQuery({
  baseUrl: '/api',
  credentials: 'include', // send cookies
  prepareHeaders: (headers, { getState }) => {
    // Example: attach token from state if needed
    const token = getState()?.auth?.accessToken;
    if (token) {
      headers.set('authorization', `Bearer ${token}`);
    }
    return headers;
  },
});

// Wrapper to handle refresh logic automatically
const baseQueryWithReauth = async (args, api, extraOptions) => {
  await mutex.waitForUnlock();

  let result = await baseQuery(args, api, extraOptions);

  if (result.error && result.error.status === 401) {
    if (!mutex.isLocked()) {
      const release = await mutex.acquire();
      try {
        // Try refreshing token
        const refreshResult = await baseQuery(
          { url: '/auth/refresh', method: 'POST' },
          api,
          extraOptions
        );

        if (refreshResult?.data) {
          // Store new token in Redux
          api.dispatch({
            type: 'auth/setTokens',
            payload: refreshResult.data,
          });

          // Retry original query
          result = await baseQuery(args, api, extraOptions);
        } else {
          api.dispatch({ type: 'auth/logout' });
        }
      } finally {
        release();
      }
    } else {
      // Wait until refresh is done, then retry
      await mutex.waitForUnlock();
      result = await baseQuery(args, api, extraOptions);
    }
  }

  return result;
};

// Base API slice
export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: ['User', 'Pdf', 'Course', 'Order', 'Entitlement'],
  endpoints: () => ({}), // extended in feature APIs
});
