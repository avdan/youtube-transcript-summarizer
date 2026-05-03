/**
 * Background script handler for fetching transcripts
 * This avoids CORS issues by making requests from the background script
 */

export interface CaptionTrack {
  baseUrl: string;
  name?: { simpleText: string };
  vssId: string;
  languageCode: string;
  isTranslatable: boolean;
}

export async function fetchTranscriptFromBackground(videoId: string): Promise<string> {
  console.log('[Background] Fetching transcript for video:', videoId);
  
  try {
    // First, try to get the video page to extract caption data
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log('[Background] Fetching video page...');
    
    const pageResponse = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });
    
    if (!pageResponse.ok) {
      throw new Error(`Failed to fetch video page: ${pageResponse.status}`);
    }
    
    const pageHtml = await pageResponse.text();

    // Extract ytInitialPlayerResponse from the page
    console.log('[Background] Extracting player response...');
    const match = pageHtml.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);
    if (!match) {
      throw new Error('Could not find player response in page');
    }

    const playerResponse = JSON.parse(match[1]);
    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || captionTracks.length === 0) {
      console.log('[Background] No caption tracks found');
      throw new Error('No captions available for this video');
    }

    console.log('[Background] Found', captionTracks.length, 'caption tracks');

    // Find English captions or use the first available
    const track = captionTracks.find((t: CaptionTrack) => 
      t.languageCode === 'en' || t.vssId?.includes('.en')
    ) || captionTracks[0];

    if (!track.baseUrl) {
      throw new Error('No caption URL found');
    }

    console.log('[Background] Selected caption track:', track.name?.simpleText || track.languageCode);
    console.log('[Background] Caption URL:', track.baseUrl);

    // Fetch the actual transcript
    const transcriptResponse = await fetch(track.baseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/xml,application/xml,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': videoUrl
      }
    });
    
    if (!transcriptResponse.ok) {
      throw new Error(`Failed to fetch transcript: ${transcriptResponse.status}`);
    }
    
    const transcriptXml = await transcriptResponse.text();
    console.log('[Background] Got transcript response, length:', transcriptXml.length);

    // Check if response is empty
    if (!transcriptXml || transcriptXml.trim().length === 0) {
      console.error('[Background] Empty transcript response');
      throw new Error('Empty transcript response');
    }

    // Parse XML manually since DOMParser is not available in service workers
    const transcriptText = parseTranscriptXML(transcriptXml);

    console.log('[Background] Transcript extracted, length:', transcriptText.length);
    return transcriptText;
  } catch (error) {
    console.error('[Background] Transcript fetch failed:', error);
    throw error;
  }
}

/**
 * Parse XML transcript without DOMParser (for service workers)
 */
function parseTranscriptXML(xml: string): string {
  console.log('[Background] Parsing XML manually...');
  
  // Extract text content from XML using regex
  const textMatches = xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g);
  const texts: string[] = [];
  
  for (const match of textMatches) {
    let text = match[1];
    
    // Decode HTML entities
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/\n/g, ' ')
      .trim();
    
    if (text) {
      texts.push(text);
    }
  }
  
  console.log('[Background] Extracted', texts.length, 'text segments');
  return texts.join(' ');
}

/**
 * Alternative method using direct API
 */
export async function fetchTranscriptDirect(videoId: string): Promise<string> {
  try {
    const params = new URLSearchParams({
      v: videoId,
      lang: 'en',
      fmt: 'srv3'
    });

    const url = `https://www.youtube.com/api/timedtext?${params.toString()}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const xmlText = await response.text();
    console.log('[Background] Direct API response length:', xmlText.length);
    
    if (!xmlText || xmlText.trim().length === 0) {
      throw new Error('Empty response from direct API');
    }
    
    // Parse XML manually since DOMParser is not available in service workers
    const transcriptText = parseTranscriptXML(xmlText);
    
    return transcriptText;
  } catch (error) {
    console.error('Direct API transcript fetch failed:', error);
    throw error;
  }
}