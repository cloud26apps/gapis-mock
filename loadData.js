import StreamZip from 'node-stream-zip'; import { fileURLToPath } from 'url';

export async function loadFile(targetFile, service = '') {
    let zipPath = fileURLToPath(new URL('./data.zip', import.meta.url));
    if (!loadFile.cache) loadFile.cache = new Map();
    let zip = loadFile.cache.get(zipPath);
    if (!zip) { zip = new StreamZip.async({ file: zipPath }); }
    // else { console.log(`Using cached zip for ${zipPath}`); }
    try {
        const data = await zip.entryData(targetFile);
        // if (zip) await zip.close();
        if (!loadFile.cache.has(zipPath)) loadFile.cache.set(zipPath, zip);
        return data.toString('utf8');
    } catch (err) {
        // if 'entry not found' (zip file exists but target file missing), keep zip in cache
        if (err.message?.toLowerCase().includes('entry not found')) {
            if (!loadFile.cache.has(zipPath)) loadFile.cache.set(zipPath, zip);
            // service provided, check if valid service
            // throw new Error(`@@Service (${service}) is only available in premium version/free trial. Please contact us for premium access/support/customizations.@@`);
            throw new Error(`File not found in data.zip : ${targetFile}`);
        }
        // any other error, remove zip from cache and close it
        else {
            loadFile.cache.delete(zipPath);
            try { await zip.close(); } catch (e) { }
        }
        throw new Error(`Error loading file: ${zipPath} >> ${targetFile} , ` + err.message);
    }
}
