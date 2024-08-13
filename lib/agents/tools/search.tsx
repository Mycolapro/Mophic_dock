import { tool } from 'ai'
import { createStreamableValue } from 'ai/rsc'
import Exa from 'exa-js'
import { searchSchema } from '@/lib/schema/search'
import { SearchSection } from '@/components/search-section'
import { ToolProps } from '.'
import { sanitizeUrl } from '@/lib/utils'
import { SearchResults, SearchResultItem, SearchXNGResponse, SearchXNGResult } from '@/lib/types'

export const searchTool = ({ uiStream, fullResponse }: ToolProps) =>
  tool({
    description: 'Search the web for information',
    parameters: searchSchema,
    execute: async ({
      query,
      max_results,
      search_depth,
      include_domains,
      exclude_domains
    }) => {
      let hasError = false
      // Append the search section
      const streamResults = createStreamableValue<string>()
      uiStream.update(
        <SearchSection
          result={streamResults.value}
          includeDomains={include_domains}
        />
      )

      // Ensure minimum query length for all APIs
      const filledQuery =
        query.length < 5 ? query + ' '.repeat(5 - query.length) : query
      let searchResult: SearchResults
      const searchAPI = (process.env.SEARCH_API as 'tavily' | 'exa' | 'searchxng') || 'tavily'
      console.log(`Using search API: ${searchAPI}`)

      try {
        searchResult = await (
          searchAPI === 'tavily'
            ? tavilySearch
            : searchAPI === 'exa'
            ? exaSearch
            : searchXNGSearch
        )(filledQuery, max_results, search_depth, include_domains, exclude_domains)
      } catch (error) {
        console.error('Search API error:', error)
        hasError = true
        searchResult = { results: [], query: filledQuery, images: [], number_of_results: 0 }
      }

      if (hasError) {
        fullResponse = `An error occurred while searching for "${filledQuery}".`
        uiStream.update(null)
        streamResults.done()
        return searchResult
      }

      streamResults.done(JSON.stringify(searchResult))
      return searchResult
    }
  })

async function tavilySearch(
  query: string,
  maxResults: number = 10,
  searchDepth: 'basic' | 'advanced' = 'basic',
  includeDomains: string[] = [],
  excludeDomains: string[] = []
): Promise<SearchResults> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is not set in the environment variables')
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: Math.max(maxResults, 5),
      search_depth: searchDepth,
      include_images: true,
      include_answers: true,
      include_domains: includeDomains,
      exclude_domains: excludeDomains
    })
  })

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return {
    ...data,
    images: data.images.map((url: string) => sanitizeUrl(url))
  }
}

async function exaSearch(
  query: string,
  maxResults: number = 10,
  _searchDepth: string,
  includeDomains: string[] = [],
  excludeDomains: string[] = []
): Promise<SearchResults> {
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) {
    throw new Error('EXA_API_KEY is not set in the environment variables')
  }

  const exa = new Exa(apiKey)
  const exaResults = await exa.searchAndContents(query, {
    highlights: true,
    numResults: maxResults,
    includeDomains,
    excludeDomains
  })

  return {
    results: exaResults.results.map((result: any) => ({
      title: result.title,
      url: result.url,
      content: result.highlight || result.text
    })),
    query,
    images: [],
    number_of_results: exaResults.results.length
  }
}

async function searchXNGSearch(
  query: string,
  maxResults: number = 10,
  _searchDepth: string,
  includeDomains: string[] = [],
  excludeDomains: string[] = []
): Promise<SearchResults> {
  const apiUrl = process.env.SEARCHXNG_API_URL
  if (!apiUrl) {
    throw new Error('SEARCHXNG_API_URL is not set in the environment variables')
  }

  try {
    // Construct the URL with query parameters
    const url = new URL(`${apiUrl}/search`)
    url.searchParams.append('q', query)
    url.searchParams.append('format', 'json')
    url.searchParams.append('max_results', maxResults.toString())
    // Enable both general and image results
    url.searchParams.append('categories', 'general,images')
    // Add domain filters if specified
    if (includeDomains.length > 0) {
      url.searchParams.append('include_domains', includeDomains.join(','))
    }
    if (excludeDomains.length > 0) {
      url.searchParams.append('exclude_domains', excludeDomains.join(','))
    }
    // Fetch results from SearchXNG
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`SearchXNG API error (${response.status}):`, errorText)
      throw new Error(`SearchXNG API error: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data: SearchXNGResponse = await response.json()
    //console.log('SearchXNG API response:', JSON.stringify(data, null, 2))

    // Separate general results and image results
    const generalResults = data.results.filter(result => !result.img_src)
    const imageResults = data.results.filter(result => result.img_src)
    
    // Format the results to match the expected SearchResults structure
    return {
      results: generalResults.map((result: SearchXNGResult): SearchResultItem => ({
        title: result.title,
        url: result.url,
        content: result.content
      })),
      query: data.query,
      images: imageResults.map(result => {
        const imgSrc = result.img_src || '';
        // If image_proxy is disabled, img_src should always be a full URL
        // If it's enabled, it might be a relative URL
        return imgSrc.startsWith('http') ? imgSrc : `${apiUrl}${imgSrc}`
      }).filter(Boolean), // Remove any empty strings
      number_of_results: data.number_of_results
    }
  } catch (error) {
    console.error('SearchXNG API error:', error)
    throw error
  }
}