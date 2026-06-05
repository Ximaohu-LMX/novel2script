import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base 设为 './' 使打包产物可在 GitHub Pages 任意子路径下运行,
// 也可在本地直接 preview。若部署到 username.github.io/repo/ 仍可正常加载资源。
export default defineConfig({
  plugins: [react()],
  base: './',
})
