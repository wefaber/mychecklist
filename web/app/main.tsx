import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/index.css'
import { applyTheme, useTheme } from '../lib/theme'
import { router } from './router'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
})

// Los atributos ya los puso el script de index.html; esto deja el store y el documento de acuerdo.
const { palette, mode } = useTheme.getState()
applyTheme(palette, mode)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation}>
          <RouterProvider router={router} />
        </LazyMotion>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
)
