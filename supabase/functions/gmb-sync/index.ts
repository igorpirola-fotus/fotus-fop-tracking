import { createClient } from "npm:@supabase/supabase-js@2"
import { getGoogleAccessToken } from "../_shared/google-auth.ts"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get("authorization") || ""
  const expectedAuth = `Bearer ${Deno.env.get("CRON_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
  if (authHeader !== expectedAuth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    })
  }

  try {
    console.log("Starting GMB reviews sync...")
    
    // Get OAuth2 Access Token for My Business scope
    const scope = "https://www.googleapis.com/auth/business.manage"
    const accessToken = await getGoogleAccessToken(scope)

    // 1) List GMB Accounts
    const accountsRes = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
      headers: { "Authorization": `Bearer ${accessToken}` }
    })
    
    if (!accountsRes.ok) {
      throw new Error(`Failed to list accounts (${accountsRes.status}): ${await accountsRes.text()}`)
    }
    
    const accountsData = await accountsRes.json()
    const accounts = accountsData.accounts || []
    
    console.log(`Found ${accounts.length} accounts.`)
    let totalSyncedReviews = 0

    for (const account of accounts) {
      const accountName = account.name // ex: 'accounts/12345'
      
      // 2) List Locations for each Account
      const locationsUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title`
      const locationsRes = await fetch(locationsUrl, {
        headers: { "Authorization": `Bearer ${accessToken}` }
      })
      
      if (!locationsRes.ok) {
        console.error(`Failed to list locations for ${accountName} (${locationsRes.status}): ${await locationsRes.text()}`)
        continue
      }
      
      const locationsData = await locationsRes.json()
      const locations = locationsData.locations || []
      
      console.log(`Account ${accountName} has ${locations.length} locations.`)

      for (const location of locations) {
        const locationName = location.name // ex: 'locations/67890'
        const locationTitle = location.title // ex: 'Fotus Solar - Vila Velha'
        
        // 3) List Reviews for each Location
        // GBP Reviews API v4 endpoint structure: https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews
        const reviewsUrl = `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/reviews`
        const reviewsRes = await fetch(reviewsUrl, {
          headers: { 
            "Authorization": `Bearer ${accessToken}`,
            "Accept-Language": "pt-BR"
          }
        })
        
        if (!reviewsRes.ok) {
          console.error(`Failed to list reviews for location ${locationName} (${reviewsRes.status}): ${await reviewsRes.text()}`)
          continue
        }
        
        const reviewsData = await reviewsRes.json()
        const reviews = reviewsData.reviews || []
        
        console.log(`Location ${locationTitle} has ${reviews.length} reviews.`)

        for (const review of reviews) {
          const ratingMap: Record<string, number> = {
            "FIVE": 5,
            "FOUR": 4,
            "THREE": 3,
            "TWO": 2,
            "ONE": 1
          }
          const numericRating = ratingMap[review.starRating] || 5

          // Check if reply exists
          const replyText = review.reviewReply?.comment || null
          const repliedAt = review.reviewReply?.updateTime || null
          const replyPending = !replyText

          const { error } = await supabase.from("gmb_reviews").upsert({
            google_review_id: review.reviewId,
            location_name: locationTitle,
            location_id: locationName,
            rating: numericRating,
            review_text: review.comment || null,
            reviewer_name: review.reviewer?.displayName || "Anônimo",
            reviewer_photo_url: review.reviewer?.profilePhotoUrl || null,
            reply_text: replyText,
            replied_at: repliedAt,
            reply_pending: replyPending,
            published_at: review.createTime,
            updated_at: new Date().toISOString()
          }, { onConflict: "google_review_id" })

          if (error) {
            console.error(`Failed to upsert review ${review.reviewId}: ${error.message}`)
          } else {
            totalSyncedReviews++
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, synced_reviews: totalSyncedReviews }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    })

  } catch (error) {
    console.error(`GMB reviews sync failed: ${error.message}`)
    
    // Log to error_logs table if possible
    await supabase.from("error_logs").insert({
      function_name: "gmb-sync",
      error_message: error.message,
      payload: null
    }).catch(() => {})

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    })
  }
})
