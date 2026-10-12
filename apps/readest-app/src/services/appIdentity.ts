const isGlossaDev = () => process.env['NEXT_PUBLIC_GLOSSA_RUNTIME_ID'] === 'app.glossa.reader.dev';

export const getAppName = () => (isGlossaDev() ? 'Glossa Dev' : 'Glossa');
export const getAppScheme = () => (isGlossaDev() ? 'glossa-dev' : 'glossa');
