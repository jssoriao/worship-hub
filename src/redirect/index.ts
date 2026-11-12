/**
 * The app's previous address. Every request is sent to the same path on the current address (301),
 * so old links and bookmarks keep working. Deployed on its own: `pnpm cf:deploy:redirect`.
 */
const TARGET = 'https://worshiphub.jssoriao.dev'

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url)
    return Response.redirect(`${TARGET}${url.pathname}${url.search}`, 301)
  },
}
